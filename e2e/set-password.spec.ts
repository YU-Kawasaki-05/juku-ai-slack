import { test, expect, request, type APIRequestContext } from '@playwright/test'
import { alert } from './fixtures/ui'
import { EXPIRED_LINK_MESSAGE, NO_LINK_MESSAGE } from '../src/app/set-password/passwordSetup'

/**
 * 招待リンク方式（スタッフのパスワード自己設定）の受け入れ検証。
 *
 * 運用: 管理者が scripts/invite-staff.mjs でランダムパスワードのアカウントを作り、
 * Admin API の generate_link(type=recovery) で本人専用リンクを発行して Slack DM で渡す。
 * 本人がリンクを開き、この画面で自分のパスワードを決める。
 *
 * ここで固定したい事実:
 *   1. /set-password は未認証で開ける（middleware の matcher に入っていない）。
 *      入れるとリダイレクトで URL フラグメントが消え、招待リンクが機能しなくなる
 *   2. 期限切れ・使用済みリンクは日本語で再発行を案内する
 *   3. リンクからパスワードを設定すると /admin に入れ、そのパスワードで再ログインできる
 *
 * ⚠️ redirect_to は **127.0.0.1** で組む。GoTrue の許可判定はループバック IP を通すが
 * ホスト名 `localhost` は通さず、黙って Site URL に差し替える（実測）。
 * baseURL は localhost なので、この spec だけ 127.0.0.1 の絶対 URL で操作する。
 */

const INVITE_EMAIL = 'e2e-invite@example.test'
const NEW_PASSWORD = 'e2e-invite-Passw0rd!'

function appOrigin(baseURL: string | undefined): string {
  const url = new URL(baseURL ?? 'http://localhost:3200')
  url.hostname = '127.0.0.1'
  return url.origin
}

function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('E2E: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
  }
  return { url, key }
}

async function adminApi(): Promise<APIRequestContext> {
  const { url, key } = supabaseEnv()
  return request.newContext({
    baseURL: url,
    extraHTTPHeaders: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  })
}

async function findUserId(api: APIRequestContext, email: string): Promise<string | null> {
  const res = await api.get('/auth/v1/admin/users', { params: { page: '1', per_page: '200' } })
  if (!res.ok()) throw new Error(`E2E: ユーザー一覧の取得に失敗 ${res.status()}`)
  const { users } = (await res.json()) as { users: Array<{ id: string; email: string }> }
  return users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null
}

async function deleteInviteUser(api: APIRequestContext): Promise<void> {
  const id = await findUserId(api, INVITE_EMAIL)
  if (id) await api.delete(`/auth/v1/admin/users/${id}`)
}

/** 招待対象のアカウントを作る（scripts/invite-staff.mjs と同じ手順） */
async function createInviteUser(api: APIRequestContext): Promise<void> {
  const res = await api.post('/auth/v1/admin/users', {
    data: {
      email: INVITE_EMAIL,
      // 誰も知らない使い捨てパスワード。本人がリンクで上書きする
      password: `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ''),
      email_confirm: true,
      app_metadata: { role: 'staff' },
    },
  })
  if (!res.ok()) throw new Error(`E2E: 招待ユーザーの作成に失敗 ${res.status()} ${await res.text()}`)
}

/** 本人専用の招待リンク（Supabase の /auth/v1/verify への URL）を発行する */
async function generateInviteLink(api: APIRequestContext, origin: string): Promise<string> {
  const res = await api.post('/auth/v1/admin/generate_link', {
    data: { type: 'recovery', email: INVITE_EMAIL, redirect_to: `${origin}/set-password` },
  })
  if (!res.ok()) throw new Error(`E2E: 招待リンクの発行に失敗 ${res.status()} ${await res.text()}`)
  const body = (await res.json()) as { action_link: string; redirect_to: string }
  // 許可されない redirect_to は黙って Site URL に差し替えられる。気付かず落ちるのを防ぐ
  expect(body.redirect_to).toBe(`${origin}/set-password`)
  return body.action_link
}

test.describe('招待リンクからのパスワード設定（/set-password）', () => {
  // 同じユーザーを作って消すので直列に流す
  test.describe.configure({ mode: 'serial' })

  let api: APIRequestContext

  test.beforeAll(async () => {
    api = await adminApi()
    await deleteInviteUser(api)
  })

  test.afterAll(async () => {
    await deleteInviteUser(api)
    await api.dispose()
  })

  test('リンク無しで直接開いたら、招待リンクから開くよう案内する（フォームは出さない）', async ({
    page,
  }) => {
    await page.goto('/set-password')
    await expect(alert(page)).toContainText(NO_LINK_MESSAGE)
    await expect(page.getByLabel('新しいパスワード', { exact: true })).toHaveCount(0)
  })

  test('無効・期限切れのリンクは有効期限切れとして再発行を案内する', async ({ page, baseURL }) => {
    const origin = appOrigin(baseURL)
    const { url } = supabaseEnv()
    // 存在しないトークン。Supabase は期限切れ・使用済み・不正をすべて otp_expired で返す
    await page.goto(
      `${url}/auth/v1/verify?token=${'0'.repeat(56)}&type=recovery&redirect_to=${origin}/set-password`,
    )
    await expect(page).toHaveURL(new RegExp(`${origin.replace(/[.]/g, '\\.')}/set-password`))
    await expect(alert(page)).toContainText(EXPIRED_LINK_MESSAGE)
    await expect(page.getByLabel('新しいパスワード', { exact: true })).toHaveCount(0)
  })

  test('リンクでパスワードを設定すると /admin に入れ、そのパスワードで再ログインできる', async ({
    page,
    baseURL,
  }) => {
    const origin = appOrigin(baseURL)
    await createInviteUser(api)
    const inviteLink = await generateInviteLink(api, origin)

    // 1. 本人がリンクを開く → フラグメントのトークンでセッションが確立しフォームが出る
    await page.goto(inviteLink)
    await expect(page).toHaveURL(new RegExp('/set-password'))
    await expect(page.getByLabel('新しいパスワード', { exact: true })).toBeVisible()
    // トークンを URL（履歴）に残さない
    expect(new URL(page.url()).hash).toBe('')

    // 2. 短すぎるパスワードはブラウザ検証で送信されない（最低文字数を UI で明示している）
    await expect(page.getByText('8 文字以上。使い回しは避けてください')).toBeVisible()

    // 3. 不一致は弾かれる
    await page.getByLabel('新しいパスワード', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('新しいパスワード（確認）').fill(`${NEW_PASSWORD}x`)
    await page.getByRole('button', { name: 'パスワードを設定する' }).click()
    await expect(alert(page)).toContainText('パスワードが一致しません')

    // 4. 一致させて設定 → /admin に入れる
    await page.getByLabel('新しいパスワード', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('新しいパスワード（確認）').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'パスワードを設定する' }).click()
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 })

    // 5. 同じリンクは 1 回限り（2 回目は期限切れ扱い）
    await page.context().clearCookies()
    await page.goto(inviteLink)
    await expect(alert(page)).toContainText(EXPIRED_LINK_MESSAGE)

    // 6. 本人が決めたパスワードでログインし直せる
    await page.goto(`${origin}/login`)
    await page.getByLabel('メールアドレス').fill(INVITE_EMAIL)
    await page.getByLabel('パスワード').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'ログイン' }).click()
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 })
  })
})
