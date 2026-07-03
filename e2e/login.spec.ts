import { test, expect } from '@playwright/test'

test('unauthenticated access to /admin redirects to /login', async ({ page }) => {
  await page.goto('/admin')
  await expect(page).toHaveURL('/login')
})

test('login page renders form', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('メールアドレス')).toBeVisible()
  await expect(page.getByLabel('パスワード')).toBeVisible()
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible()
})
