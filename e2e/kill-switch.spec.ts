import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STATE, STAFF_STATE } from './fixtures/users'
import { resetKillSwitch } from './fixtures/db'
import { acquireLock, KILL_SWITCH_LOCK } from './fixtures/lock'
import { toast } from './fixtures/ui'

/**
 * AI 応答の緊急停止スイッチ（DEC-15 / F-1）。
 * kill_switches は全生徒に効くグローバル状態なので、この spec は直列実行し
 * 最後に必ず「稼働中」へ戻す。
 *
 * さらに、同じ行を触る受け入れテスト（e2e/acceptance/kill-switch-rate-limit.spec.ts）とは
 * 別ワーカーで並列になり得るため、ファイル間ロックで排他する。
 */
test.describe.configure({ mode: 'serial' })

let release: (() => void) | undefined

test.beforeAll(async () => {
  release = await acquireLock(KILL_SWITCH_LOCK)
})

test.afterAll(async () => {
  await resetKillSwitch()
  release?.()
})

/** 現在の状態からトグルボタンのラベルを決める（他テストの実行順に依存しないため） */
async function currentToggle(page: Page): Promise<{ enabled: boolean; label: string }> {
  const enabled = await page.getByText('稼働中', { exact: true }).isVisible()
  return { enabled, label: enabled ? 'AI応答を停止' : 'AI応答を再開' }
}

test.describe('管理者', () => {
  test.use({ storageState: ADMIN_STATE })

  test('停止 → 理由入力 → 確認 → 再開ができる', async ({ page }) => {
    await page.goto('/admin')
    // 前提を揃える（他の spec が触っていても必ず稼働中から始める）
    await resetKillSwitch()
    await page.reload()
    await expect(page.getByText('稼働中', { exact: true })).toBeVisible()

    // 停止
    await page.getByRole('button', { name: 'AI応答を停止' }).click()
    await expect(page.getByRole('dialog')).toContainText('AI応答を停止しますか？')
    await page.getByLabel('理由').fill('E2E: 停止の動作確認')
    await page.getByRole('button', { name: '停止する' }).click()

    await expect(toast(page)).toContainText(/AI応答を停止(しました|し、)/)
    await expect(page.getByText('停止中', { exact: true })).toBeVisible()
    await expect(page.getByText('理由: E2E: 停止の動作確認')).toBeVisible()

    // 再開
    await page.getByRole('button', { name: 'AI応答を再開' }).click()
    await expect(page.getByRole('dialog')).toContainText('AI応答を再開しますか？')
    await page.getByLabel('理由').fill('E2E: 復旧確認')
    await page.getByRole('button', { name: '再開する' }).click()

    await expect(toast(page)).toContainText(/AI応答を再開(しました|し、)/)
    await expect(page.getByText('稼働中', { exact: true })).toBeVisible()
  })
})

test.describe('スタッフ', () => {
  test.use({ storageState: STAFF_STATE })

  test('切替は拒否され、状態は変わらない', async ({ page }) => {
    await page.goto('/admin')
    const { enabled, label } = await currentToggle(page)

    await page.getByRole('button', { name: label }).click()
    await page.getByRole('button', { name: enabled ? '停止する' : '再開する' }).click()

    await expect(toast(page)).toContainText('AI応答の停止・再開は管理者のみ実行できます')
    // 失敗時はダイアログを閉じない（操作をやり直せるようにするため）
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.reload()
    await expect(page.getByText(enabled ? '稼働中' : '停止中', { exact: true })).toBeVisible()
  })
})
