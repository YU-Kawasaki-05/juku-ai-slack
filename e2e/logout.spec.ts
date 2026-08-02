import { test, expect } from '@playwright/test'
import { testUsers } from './fixtures/users'

/**
 * ログイン → ログアウト → 保護ページが /login に戻ることの確認（FR-13）。
 *
 * storageState は使わず毎回 UI からログインする。supabase.auth.signOut() は既定で
 * scope='global' なので、admin/staff のセッションを共有すると並列実行中の他テストを
 * 巻き添えでログアウトさせてしまうため、このテストだけ専用ユーザーを使う。
 */
test('ログアウトすると /admin が /login にリダイレクトされる', async ({ page }) => {
  const user = testUsers.logout

  await page.goto('/login')
  await page.getByLabel('メールアドレス').fill(user.email)
  await page.getByLabel('パスワード').fill(user.password)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page).toHaveURL(/\/admin$/)

  await page.getByRole('button', { name: user.email }).click()
  await page.getByRole('menuitem', { name: 'ログアウト' }).click()
  await expect(page).toHaveURL(/\/login/)

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login/)
})
