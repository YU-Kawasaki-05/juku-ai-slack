import { test, expect } from '@playwright/test'

/**
 * 認証境界: middleware.ts で /admin/* が保護されていること。
 * 未認証アクセスは必ず /login にリダイレクトされる（FR-13）。
 */
const PROTECTED_PATHS = [
  '/admin',
  '/admin/persons',
  '/admin/persons/new',
  '/admin/channels',
  '/admin/channels/new',
  '/admin/reports',
  '/admin/reports/new',
  '/admin/errors',
  '/admin/jobs',
  '/admin/usage',
  '/admin/conversations',
  // ロールなしユーザー向けの案内ページ。ログインしていない人には見せない
  '/admin/no-access',
]

test.describe('認証ガード（未認証アクセス）', () => {
  for (const path of PROTECTED_PATHS) {
    test(`${path} は未認証で /login にリダイレクトされる`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
    })
  }
})
