import { defineConfig, devices } from '@playwright/test'
import { loadTestEnv } from './scripts/test-env.mjs'

// .env.test（無ければ .env.test.example）を読み込む。
// 戻り値は「E2E 用に明示した値」だけなので、webServer へはこれを最後に重ねて
// 本番の .env.local が混入しないようにする。
const testEnv = loadTestEnv()

// Playwright 専用ポート（開発用の 3000 と分離する）。PW_PORT で上書き可
const PORT = process.env.PW_PORT ?? '3200'
const baseURL = `http://localhost:${PORT}`

// 受け入れテスト用の外部サービスモック（Slack Web API + OpenAI 互換 LLM）。
// 実 API を絶対に叩かせないため、アプリの SLACK_API_BASE_URL / LLM_BASE_URL をここへ向ける。
const MOCK_PORT = process.env.MOCK_PORT ?? testEnv.MOCK_PORT ?? '3251'
const mockBase = `http://127.0.0.1:${MOCK_PORT}`

// ローカルに playwright 管理外の Chromium しか無い場合、そのパスを PW_CHROMIUM_PATH で渡せる
// （CI では `npx playwright install chromium` で解決する）
const executablePath = process.env.PW_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: './e2e',
  // テストユーザー作成 + storageState 生成（認証後フロー用）
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  // 管理画面は全ページが SSR + 複数クエリなので、ワーカーを並列に回すと
  // 単一の `next start` に負荷が集中し、クライアント遷移後の描画が既定の 5 秒を超えることがある
  expect: { timeout: 10_000 },
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
  // 本番ビルドを専用ポートで配信（開発中の 3000 と独立）。`pnpm test:e2e` が build を含む。
  //
  // reuseExistingServer は常に false。true にすると「前回の古いビルドを配信中のサーバー」を
  // 黙って使い回してしまい、直したはずの不具合が再現し続ける事故が起きる。
  // 3200 が既に埋まっている場合は Playwright が起動失敗するので、その方が気付ける。
  webServer: [
    // 外部サービスのモック。アプリより先に上げる（Playwright は全 webServer の url を待つ）
    {
      command: `node e2e/acceptance/mock-server.mjs`,
      url: `${mockBase}/__mock/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ...(process.env as Record<string, string>), MOCK_PORT },
    },
    {
      command: `pnpm exec next start --port ${PORT}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      // E2E 用 env を最後に重ねる（.env.local を読み込ませない / ローカル Supabase に固定する）
      env: {
        ...(process.env as Record<string, string>),
        ...testEnv,
        // モックのポートを上書きした場合も追随させる
        SLACK_API_BASE_URL: `${mockBase}/slack`,
        LLM_BASE_URL: `${mockBase}/llm`,
      },
    },
  ],
})
