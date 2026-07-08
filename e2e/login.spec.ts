import { test, expect } from '@playwright/test'

test.describe('ログイン画面（SCR-01）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('ブランド見出しとフォームが表示される', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'じゅくAI 管理画面' })).toBeVisible()
    await expect(page.getByLabel('メールアドレス')).toBeVisible()
    await expect(page.getByLabel('パスワード')).toBeVisible()
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible()
  })

  test('入力欄の type が適切（email / password）', async ({ page }) => {
    await expect(page.getByLabel('メールアドレス')).toHaveAttribute('type', 'email')
    await expect(page.getByLabel('パスワード')).toHaveAttribute('type', 'password')
  })

  test('必須項目が空だと送信されず /login に留まる', async ({ page }) => {
    await page.getByRole('button', { name: 'ログイン' }).click()
    await expect(page).toHaveURL(/\/login/)
    const valueMissing = await page
      .getByLabel('メールアドレス')
      .evaluate((el) => (el as HTMLInputElement).validity.valueMissing)
    expect(valueMissing).toBe(true)
  })

  test('誤った認証情報ではエラーが表示される', async ({ page }) => {
    await page.getByLabel('メールアドレス').fill('nobody@example.com')
    await page.getByLabel('パスワード').fill('definitely-wrong-password')
    await page.getByRole('button', { name: 'ログイン' }).click()
    // Supabase 認証失敗 → Alert（role="alert"）が表示される
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/login/)
  })
})
