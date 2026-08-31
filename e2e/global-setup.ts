import { chromium, request, type FullConfig } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { ADMIN_STATE, STAFF_STATE, testUsers } from './fixtures/users'

/**
 * E2E の前提を整える:
 *  1. Supabase Admin API で admin / staff のテストユーザーを冪等に作成（app_metadata.role を付与）
 *  2. それぞれ実際に /login を通してセッションを取得し storageState として保存
 *
 * app_metadata は Service Role でしか書けない（requireAdmin.ts の権限判定がここを見る）。
 * user_metadata では権限昇格できないため、必ず Admin API 経由で設定する。
 */
async function upsertUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  user: { email: string; password: string; role: 'admin' | 'staff' },
): Promise<void> {
  const api = await request.newContext({
    baseURL: supabaseUrl,
    extraHTTPHeaders: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  })
  try {
    const body = {
      email: user.email,
      password: user.password,
      email_confirm: true,
      app_metadata: { role: user.role },
    }

    const created = await api.post('/auth/v1/admin/users', { data: body })
    if (created.ok()) return

    // 既存ユーザー（email_exists）なら id を引いて更新する
    const list = await api.get('/auth/v1/admin/users', { params: { page: '1', per_page: '200' } })
    if (!list.ok()) {
      throw new Error(`E2E: ユーザー一覧の取得に失敗 ${list.status()} ${await list.text()}`)
    }
    const { users } = (await list.json()) as { users: Array<{ id: string; email: string }> }
    const existing = users.find((u) => u.email?.toLowerCase() === user.email.toLowerCase())
    if (!existing) {
      throw new Error(`E2E: ${user.email} の作成に失敗 ${created.status()} ${await created.text()}`)
    }

    const updated = await api.put(`/auth/v1/admin/users/${existing.id}`, { data: body })
    if (!updated.ok()) {
      throw new Error(`E2E: ${user.email} の更新に失敗 ${updated.status()} ${await updated.text()}`)
    }
  } finally {
    await api.dispose()
  }
}

async function saveStorageState(
  baseURL: string,
  user: { email: string; password: string },
  path: string,
): Promise<void> {
  const executablePath = process.env.PW_CHROMIUM_PATH || undefined
  const browser = await chromium.launch({ executablePath })
  try {
    const page = await browser.newPage()
    await page.goto(`${baseURL}/login`)
    await page.getByLabel('メールアドレス').fill(user.email)
    await page.getByLabel('パスワード').fill(user.password)
    await page.getByRole('button', { name: 'ログイン' }).click()
    await page.waitForURL('**/admin', { timeout: 15_000 })
    await page.context().storageState({ path })
  } finally {
    await browser.close()
  }
}

async function globalSetup(config: FullConfig): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'E2E: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。' +
        'pnpm supabase:start を実行し、必要なら .env.test.example を .env.test にコピーしてください。',
    )
  }

  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3200'

  mkdirSync('e2e/.auth', { recursive: true })
  for (const [user, statePath] of [
    [testUsers.admin, ADMIN_STATE],
    [testUsers.staff, STAFF_STATE],
  ] as const) {
    await upsertUser(supabaseUrl, serviceRoleKey, user)
    await saveStorageState(baseURL, user, statePath)
  }
  // ログアウト専用ユーザーは storageState を作らない（spec 内で毎回ログインする）
  await upsertUser(supabaseUrl, serviceRoleKey, testUsers.logout)
}

export default globalSetup
