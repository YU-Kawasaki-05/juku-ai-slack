/** @file
 * 受け入れテスト: RLS の実効確認と権限昇格の不可能性（AT-05 系 / AT-08 系）
 * @verifies D-1 / migration 026_harden_rls_policies, 03_権限設計（app_metadata.role）
 *
 * ここはアプリ（Service Role で RLS をバイパスする）ではなく、
 * **ブラウザから直接叩ける経路**（anon key + ユーザー JWT の PostgREST）を検証する。
 */
import { test, expect } from '@playwright/test'
import { STAFF_STATE, testUsers } from '../fixtures/users'
import { createPerson, createReport, deletePersons, uniqueSuffix } from '../fixtures/db'
import { alert, toast } from '../fixtures/ui'
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

/**
 * ロールなしユーザーはこの spec 全体で共有する可変リソースなので、**ワーカーごとに分ける**。
 * 単一アカウントにすると、fullyParallel で別ワーカーの afterAll が
 * このアカウントを削除した瞬間に他ワーカーのログインが落ちる（AT-05 の偽 FAIL 原因）。
 * TEST_PARALLEL_INDEX は同時実行されるワーカー間で必ず一意（Playwright が保証）。
 */
const WORKER_TAG = process.env.TEST_PARALLEL_INDEX ?? '0'
const ROLELESS_EMAIL = `e2e-noroles-w${WORKER_TAG}@example.test`
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

/**
 * AT-11: migration 026 は staff/admin に SELECT ポリシーを作っているが、
 * migration 024 の GRANT 整理で `authenticated` にはテーブル権限自体が残っていない
 * （SELECT/INSERT/UPDATE/DELETE なし。TRUNCATE/TRIGGER/REFERENCES のみ）。
 * よってポリシー評価より前に GRANT で弾かれる = **設計より厳しい安全側**の挙動。
 * アプリ本体は Service Role で動くため機能影響はなく、
 * 「ブラウザから届く経路には PII が 1 行も出ない」ことがここで確定する。
 * 詳細は docs/07_受け入れテスト/91_既知の制約.md（OBS-01）。
 */
test('AT-11 staff ロールの JWT でも PostgREST からは PII を読めない（GRANT による多層防御）', async ({
  request,
}) => {
  const token = await signInForToken(request, testUsers.staff.email, testUsers.staff.password)
  const { status, rows, body } = await restSelect(request, 'persons', token)
  expect(status).toBe(403)
  expect(body).toContain('permission denied')
  expect(rows).toHaveLength(0)
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
 * AT-05: 「サインアップできただけ（ロールなし）」のユーザーが管理画面に入れないこと。
 *
 * 03_権限設計 の EP-02〜EP-18 は "admin または staff" を要求している。
 * migration 026 は PostgREST 直アクセスを塞ぐだけで、管理画面は Service Role で
 * RLS をバイパスするため、アプリ側（requireStaff / requireStaffPage）でも
 * app_metadata.role を検証しないと全生徒の PII が漏れる。
 *
 * ログイン自体は成功する（Supabase Auth のアカウントは有効）ので、
 * /login に戻すのではなく専用ページ /admin/no-access で理由と対処を出す。
 */
const NO_ACCESS_HEADING = 'このアカウントには管理画面の利用権限が設定されていません'

test.describe('ロールなしユーザー', () => {
  test('AT-05 ロールなしユーザーは管理画面を利用できない（/admin/no-access に案内される）', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByLabel('メールアドレス').fill(ROLELESS_EMAIL)
    await page.getByLabel('パスワード').fill(ROLELESS_PASSWORD)
    await page.getByRole('button', { name: 'ログイン' }).click()

    // ログイン自体は通るが、管理画面ではなく権限なし画面に着地する
    await page.waitForURL('**/admin/no-access', { timeout: 15_000 })

    // URL を直接叩いても同じ（middleware だけでなくページ側でも弾いている）
    await page.goto('/admin/persons')
    await expect(page).toHaveURL(/\/admin\/no-access$/)
    await expect(page.getByRole('heading', { name: NO_ACCESS_HEADING, level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: '生徒管理', level: 1 })).toHaveCount(0)
    // 誰でログインしているかと、別アカウントへの切り替え手段を出す
    await expect(page.getByText(ROLELESS_EMAIL, { exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'ログアウトして別のアカウントでログイン' }),
    ).toBeVisible()
    await shot(page, 'AT-05_ロールなしユーザーは管理画面を利用できない')
  })

  test('AT-05b user_metadata に role を自称しても管理画面には入れない', async ({ page, request }) => {
    const person = await createPerson(`AT ロールなし ${uniqueSuffix()}`)
    personIds.push(person.id)

    // 本人が書き換えられるのは user_metadata のみ。ここに role=admin を入れて挑む
    const token = await signInForToken(request, ROLELESS_EMAIL, ROLELESS_PASSWORD)
    await selfSetUserMetadata(request, token, { role: 'admin' })

    await page.goto('/login')
    await page.getByLabel('メールアドレス').fill(ROLELESS_EMAIL)
    await page.getByLabel('パスワード').fill(ROLELESS_PASSWORD)
    await page.getByRole('button', { name: 'ログイン' }).click()
    await page.waitForURL('**/admin/no-access', { timeout: 15_000 })

    // admin 限定画面（EP-07〜09）も当然開けない。判定は app_metadata のみ
    await page.goto('/admin/channels/new')
    await expect(page).toHaveURL(/\/admin\/no-access$/)
    await expect(page.getByRole('heading', { name: NO_ACCESS_HEADING, level: 1 })).toBeVisible()
    await expect(page.getByLabel('SlackチャンネルID')).toHaveCount(0)
    await shot(page, 'AT-05b_user_metadata自称では管理者操作に昇格できない')
  })
})
