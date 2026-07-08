import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync } from 'node:fs'

/**
 * 認証後フロー用の storageState を生成する。
 * TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD が設定されている時のみ実行し、
 * 実際に /login からログインして得たセッション cookie を e2e/.auth/admin.json に保存する。
 * 未設定なら何もしない（authenticated.spec.ts は自動的に skip される）。
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const email = process.env.TEST_ADMIN_EMAIL
  const password = process.env.TEST_ADMIN_PASSWORD
  if (!email || !password) return

  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3200'
  const executablePath = process.env.PW_CHROMIUM_PATH || undefined
  const browser = await chromium.launch({ executablePath })
  try {
    const page = await browser.newPage()
    await page.goto(`${baseURL}/login`)
    await page.getByLabel('メールアドレス').fill(email)
    await page.getByLabel('パスワード').fill(password)
    await page.getByRole('button', { name: 'ログイン' }).click()
    await page.waitForURL('**/admin', { timeout: 15_000 })
    mkdirSync('e2e/.auth', { recursive: true })
    await page.context().storageState({ path: 'e2e/.auth/admin.json' })
  } finally {
    await browser.close()
  }
}

export default globalSetup
