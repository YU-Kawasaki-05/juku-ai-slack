import { test, expect } from '@playwright/test'
import { ADMIN_STATE } from './fixtures/users'
import { toast } from './fixtures/ui'

/**
 * ジョブ管理（FR-04 / F-4 / A-14）。Cron を使わない運用（DEC-13）なので、
 * 画面を開くこと自体とスイープボタンが運用の要になる。0 件でも成功すること。
 */
test.use({ storageState: ADMIN_STATE })

test('一覧と KPI カードが表示される', async ({ page }) => {
  await page.goto('/admin/jobs')
  await expect(page.getByRole('heading', { name: 'ジョブ管理', level: 1 })).toBeVisible()

  for (const label of ['待機中', '処理中', '失敗']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(
    page.getByText('この画面を開くと滞留ジョブの回収と古い記録の掃除を自動実行します'),
  ).toBeVisible()
})

test('スイープを実行すると 0 件でも成功トーストが出る', async ({ page }) => {
  await page.goto('/admin/jobs')
  await page.getByRole('button', { name: 'スイープ実行' }).click()
  await expect(toast(page)).toContainText(/滞留ジョブを \d+ 件回収、古い記録を \d+ 件掃除しました/)
})

test('状態フィルタが URL に反映される', async ({ page }) => {
  await page.goto('/admin/jobs')
  await page.getByLabel('状態').click()
  await page.getByRole('option', { name: '失敗のみ' }).click()
  await expect(page).toHaveURL(/status=failed/)
  await expect(page.getByText('条件に一致するジョブがありません')).toBeVisible()

  await page.getByRole('button', { name: 'クリア' }).click()
  await expect(page).toHaveURL(/\/admin\/jobs$/)
})
