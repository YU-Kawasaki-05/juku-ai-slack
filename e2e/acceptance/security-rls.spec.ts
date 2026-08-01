/** @file
 * 受け入れテスト: RLS の実効確認と権限昇格の不可能性（AT-05 系 / AT-08 系）
 * @verifies D-1 / migration 026_harden_rls_policies, 03_権限設計（app_metadata.role）
 *
 * ここはアプリ（Service Role で RLS をバイパスする）ではなく、
 * **ブラウザから直接叩ける経路**（anon key + ユーザー JWT の PostgREST）を検証する。
 */
import { test, expect } from '@playwright/test'
import { STAFF_STATE, testUsers } from '../fixtures/users'
import { createPerson, deletePersons, uniqueSuffix } from '../fixtures/db'
import {
  ANON_KEY,
  deleteAuthUser,
  restInsert,
  restSelect,
  selfSetUserMetadata,
  shot,
  signInForToken,
  upsertRolelessUser,
} from './fixtures'

/** PII を含むテーブル。ブラウザから 1 行も読めてはいけない */
const PROTECTED_TABLES = [
  'persons',
  'student_profiles',
  'reports',
  'slack_channel_bindings',
  'slack_messages',
  'ai_usage_logs',
  'ai_error_logs',
]

const ROLELESS_EMAIL = 'e2e-noroles@example.test'
const ROLELESS_PASSWORD = 'e2e-noroles-Passw0rd!'

const personIds: string[] = []
let rolelessUserId: string | undefined

test.beforeAll(async ({ request }) => {
  rolelessUserId = await upsertRolelessUser(request, ROLELESS_EMAIL, ROLELESS_PASSWORD)
  // RLS が「行が無いから 0 件」ではなく「拒否されて 0 件」であることを示すため実データを置く
  const person = await createPerson(`AT RLS 対象 ${uniqueSuffix()}`)
  personIds.push(person.id)
})

test.afterAll(async ({ request }) => {
  await deletePersons(personIds)
  if (rolelessUserId) await deleteAuthUser(request, rolelessUserId)
})

/* ------------------------------------------------------------------------- */

test('AT-08 ロールなしユーザーの JWT では保護テーブルを 1 行も読めない（migration 026）', async ({
  request,
}) => {
  const token = await signInForToken(request, ROLELESS_EMAIL, ROLELESS_PASSWORD)

  for (const table of PROTECTED_TABLES) {
    const { status, rows } = await restSelect(request, table, token)
    expect(status, `${table} の SELECT が 200 以外`).toBeLessThan(500)
    expect(rows, `${table} がロールなしユーザーに漏れています`).toHaveLength(0)
  }
})

test('AT-09 未認証（anon key のみ）では保護テーブルを 1 行も読めない', async ({ request }) => {
  for (const table of PROTECTED_TABLES) {
    const { rows } = await restSelect(request, table)
    expect(rows, `${table} が匿名アクセスに漏れています`).toHaveLength(0)
  }
})

test('AT-10 ロールなしユーザーは persons を書き換えられない（INSERT 拒否）', async ({ request }) => {
  const token = await signInForToken(request, ROLELESS_EMAIL, ROLELESS_PASSWORD)
  const status = await restInsert(
    request,
    'persons',
    { name: `AT 不正登録 ${uniqueSuffix()}`, grade: '中1', status: 'active' },
    token,
  )
  // RLS の WITH CHECK が無い = ポリシー不在で 401/403 になる
  expect([401, 403]).toContain(status)
})

test('AT-11 staff ロールの JWT なら persons を読める（ポリシーの正常系）', async ({ request }) => {
  const token = await signInForToken(request, testUsers.staff.email, testUsers.staff.password)
  const { rows } = await restSelect(request, 'persons', token)
  expect(rows.length).toBeGreaterThan(0)
})

test('AT-06 user_metadata に role を自称しても RLS は突破できない（権限昇格不能）', async ({
  request,
}) => {
  const token = await signInForToken(request, ROLELESS_EMAIL, ROLELESS_PASSWORD)

  // 本人が書き換えられるのは user_metadata のみ。ここに role を入れても効いてはならない
  const updateStatus = await selfSetUserMetadata(request, token, { role: 'admin' })
  expect(updateStatus, 'user_metadata の自己更新自体は Supabase の仕様上成功する').toBe(200)

  // 更新後の新しいトークンで再挑戦
  const escalated = await signInForToken(request, ROLELESS_EMAIL, ROLELESS_PASSWORD)
  const { rows } = await restSelect(request, 'persons', escalated)
  expect(rows, 'user_metadata.role で RLS を突破できてしまいました').toHaveLength(0)
})

test('AT-14 anon key を持っていても Slack Webhook は署名なしで拒否される', async ({ request }) => {
  const res = await request.post('/api/slack/events', {
    data: JSON.stringify({ type: 'url_verification', challenge: 'x' }),
    headers: { 'content-type': 'application/json', apikey: ANON_KEY },
  })
  expect(res.status()).toBe(401)
})

test.describe('管理画面の権限（証拠あり）', () => {
  test.use({ storageState: STAFF_STATE })

  test('AT-12 staff は Embedding 再生成を実行できない（EP-14 / BR-16-02）', async ({ page }) => {
    const person = await createPerson(`AT 権限 ${uniqueSuffix()}`)
    personIds.push(person.id)
    const report = await createReport({
      personId: person.id,
      title: `AT 権限確認 ${uniqueSuffix()}`,
      month: '2026-08-01',
    })

    await page.goto(`/admin/reports/${report.id}`)
    await page.getByRole('button', { name: 'Embedding 再生成', exact: true }).click()
    await page.getByRole('button', { name: '再生成する' }).click()
    await expect(toast(page)).toContainText('Embedding 再生成は管理者のみ実行できます')
    await shot(page, 'AT-12_staffはEmbedding再生成が拒否される')
  })

  test('AT-13 staff はチャンネル紐付けを作成できない（EP-07〜09 / D-3）', async ({ page }) => {
    const person = await createPerson(`AT 権限紐付け ${uniqueSuffix()}`)
    personIds.push(person.id)

    await page.goto('/admin/channels/new')
    await page.getByLabel('SlackチャンネルID').fill(`C${uniqueSuffix().toUpperCase().replace(/[^A-Z0-9]/g, '0')}`)
    await page.getByLabel('ワークスペースID').fill('T0E2ETEAM')
    await page.getByLabel('生徒').click()
    await page.getByRole('option', { name: person.name }).click()
    await page.getByRole('button', { name: '紐付ける' }).click()

    await expect(alert(page)).toContainText('この操作は管理者のみ実行できます')
    await shot(page, 'AT-13_staffはチャンネル紐付けを作成できない')
  })
})

/**
 * AT-05: 「サインアップできただけ（ロールなし）」のユーザーが管理画面に入れるか。
 *
 * 03_権限設計 の EP-02〜EP-18 は "admin または staff" を要求しているが、
 * 実装の requireStaff / requireStaffPage は**ログイン済みか**しか見ていない。
 * migration 026 は PostgREST 直アクセスを塞いだだけで、
 * 管理画面は Service Role で RLS をバイパスするため別防御が要る。
 *
 * ここでは現状の挙動を証拠付きで固定し（レポート側で公開ブロッカーとして扱う）、
 * 少なくとも **admin 限定操作までは昇格できない** ことを確認する。
 */
test.describe('ロールなしユーザー', () => {
  test('AT-05 ロールなしでも管理画面が開けてしまう（既知のギャップ / 要サインアップ無効化）', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByLabel('メールアドレス').fill(ROLELESS_EMAIL)
    await page.getByLabel('パスワード').fill(ROLELESS_PASSWORD)
    await page.getByRole('button', { name: 'ログイン' }).click()
    await page.waitForURL('**/admin', { timeout: 15_000 })

    await page.goto('/admin/persons')
    // 現状: 認証さえ通れば生徒一覧（PII）が見える
    await expect(page.getByRole('heading', { name: '生徒管理', level: 1 })).toBeVisible()
    await shot(page, 'AT-05_ロールなしユーザーが生徒一覧を閲覧できてしまう')
  })

  test('AT-05b ロールなしユーザーは admin 限定操作までは昇格できない', async ({ page, request }) => {
    const person = await createPerson(`AT ロールなし ${uniqueSuffix()}`)
    personIds.push(person.id)

    // user_metadata に role=admin を自称した状態でログインする
    const token = await signInForToken(request, ROLELESS_EMAIL, ROLELESS_PASSWORD)
    await selfSetUserMetadata(request, token, { role: 'admin' })

    await page.goto('/login')
    await page.getByLabel('メールアドレス').fill(ROLELESS_EMAIL)
    await page.getByLabel('パスワード').fill(ROLELESS_PASSWORD)
    await page.getByRole('button', { name: 'ログイン' }).click()
    await page.waitForURL('**/admin', { timeout: 15_000 })

    await page.goto('/admin/channels/new')
    await page.getByLabel('SlackチャンネルID').fill(`C${uniqueSuffix().toUpperCase().replace(/[^A-Z0-9]/g, '0')}`)
    await page.getByLabel('ワークスペースID').fill('T0E2ETEAM')
    await page.getByLabel('生徒').click()
    await page.getByRole('option', { name: person.name }).click()
    await page.getByRole('button', { name: '紐付ける' }).click()

    // app_metadata.role を見ているので user_metadata の自称は効かない
    await expect(alert(page)).toContainText('この操作は管理者のみ実行できます')
    await shot(page, 'AT-05b_user_metadata自称では管理者操作に昇格できない')
  })
})
