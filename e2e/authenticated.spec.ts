import { test, expect } from '@playwright/test'

/**
 * 認証後の通しフロー。実行には Supabase のテストユーザーが必要。
 * TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD を設定すると global-setup が
 * storageState を生成し、このブロックが有効化される（未設定時は skip）。
 * 生徒登録テストは実 DB に書き込むため、専用のテスト環境で実行すること。
 */
const HAS_TEST_USER = Boolean(process.env.TEST_ADMIN_EMAIL && process.env.TEST_ADMIN_PASSWORD)

test.describe('認証後フロー', () => {
  test.skip(!HAS_TEST_USER, 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD 未設定のためスキップ')
  test.use({ storageState: 'e2e/.auth/admin.json' })

  test('ダッシュボードが表示される', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible()
  })

  test('サイドバーの各画面へ遷移できる', async ({ page }) => {
    await page.goto('/admin')
    for (const [name, urlRe] of [
      ['生徒管理', /\/admin\/persons/],
      ['レポート', /\/admin\/reports/],
      ['会話ログ', /\/admin\/conversations/],
      ['ジョブ', /\/admin\/jobs/],
      ['利用状況', /\/admin\/usage/],
    ] as const) {
      await page.getByRole('link', { name }).click()
      await expect(page).toHaveURL(urlRe)
    }
  })

  test('生徒を新規登録して一覧に戻る', async ({ page }) => {
    await page.goto('/admin/persons/new')
    await page.getByLabel('名前').fill(`E2E生徒_${Date.now()}`)
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page).toHaveURL(/\/admin\/persons$/)
  })
})
