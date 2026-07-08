import { defineConfig, devices } from '@playwright/test'

// Playwright 専用ポート（開発用の 3000 と分離する）。PW_PORT で上書き可
const PORT = process.env.PW_PORT ?? '3200'
const baseURL = `http://localhost:${PORT}`

// ローカルに playwright 管理外の Chromium しか無い場合、そのパスを PW_CHROMIUM_PATH で渡せる
// （CI では `npx playwright install chromium` で解決する）
const executablePath = process.env.PW_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: './e2e',
  // テストユーザーが設定されていれば storageState を生成（認証後フロー用）
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    navigationTimeout: 15_000,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // 本番ビルドを専用ポートで配信（開発中の 3000 と独立）。
  // 事前に `pnpm build` が必要（コンパイル済みのため E2E が高速・安定）。CI は build → test:e2e。
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
