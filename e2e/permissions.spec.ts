import { test, expect } from '@playwright/test'
import { STAFF_STATE } from './fixtures/users'
import {
  createPerson,
  createReport,
  deleteBindingsByChannelIds,
  deletePersons,
  uniqueSuffix,
} from './fixtures/db'
import { toast } from './fixtures/ui'

/**
 * 権限境界（03_権限設計）。
 *
 * 2 つの境界をそれぞれ検証する:
 * - admin 限定のまま残す操作: 全生徒に影響する Embedding 再生成（EP-14）は
 *   URL から直接叩けるため requireAdmin が最後の砦
 * - staff に開放した操作: チャンネル紐付け（EP-07〜09）は担当スタッフが行う運用なので
 *   staff でも作成できる。誤操作は確認ダイアログと操作ログで抑える（権限設計 3.1）
 */
test.use({ storageState: STAFF_STATE })

const personIds: string[] = []
const channelIds: string[] = []

test.afterAll(async () => {
  await deleteBindingsByChannelIds(channelIds)
  await deletePersons(personIds)
})

test('staff は Embedding 再生成を実行できない', async ({ page }) => {
  const person = await createPerson(`E2E生徒_権限_${uniqueSuffix()}`)
  personIds.push(person.id)
  const report = await createReport({
    personId: person.id,
    title: `E2E権限レポート_${uniqueSuffix()}`,
    month: '2026-07-01',
  })

  await page.goto(`/admin/reports/${report.id}`)
  await page.getByRole('button', { name: 'Embedding 再生成', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Embedding を再生成しますか？')
  await page.getByRole('button', { name: '再生成する' }).click()

  await expect(toast(page)).toContainText('Embedding 再生成は管理者のみ実行できます')
})

/**
 * EP-07〜09 は staff 可（権限設計 3.1）。生徒チャンネルの紐付けは担当スタッフが行う運用なので、
 * admin でなくても画面に入れて作成できる。誤操作の防御は「入口を閉じる」ではなく
 * 確認ダイアログ（生徒名を明示）と操作ログが担う。
 */
test('staff はチャンネル紐付けを作成できる（EP-07〜09 / 権限設計 3.1）', async ({ page }) => {
  const person = await createPerson(`E2E生徒_権限紐付け_${uniqueSuffix()}`)
  personIds.push(person.id)
  const channel = `C${uniqueSuffix().toUpperCase().replace(/[^A-Z0-9]/g, '0')}`
  channelIds.push(channel)

  // 一覧に入れる（案内文で塞がれない）
  await page.goto('/admin/channels')
  await expect(page.getByRole('heading', { name: 'チャンネル紐付け', level: 1 })).toBeVisible()

  await page.goto('/admin/channels/new')
  await page.getByLabel('SlackチャンネルID').fill(channel)
  await page.getByLabel('ワークスペースID').fill('T0E2ETEAM')
  await page.getByLabel('チャンネル名').fill('e2e-staff-bind')
  await page.getByLabel('生徒').click()
  await page.getByRole('option', { name: person.name }).click()
  await page.getByRole('button', { name: '紐付ける' }).click()

  // 確定前に「どのチャンネルを誰に紐付けるか」を生徒名つきで確認させる
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('#e2e-staff-bind')
  await expect(dialog).toContainText(person.name)
  await dialog.getByRole('button', { name: '紐付けを確定する' }).click()

  await expect(page).toHaveURL(/\/admin\/channels$/)
  const row = page.getByRole('row').filter({ hasText: channel })
  await expect(row).toContainText(person.name)
})

/** サイドバーからも辿れる（画面に入れるのに導線が無い、という食い違いを防ぐ） */
test('staff のサイドバーにチャンネル設定が出る', async ({ page }) => {
  await page.goto('/admin')
  await expect(
    page
      .getByRole('navigation', { name: 'メインナビゲーション' })
      .getByRole('link', { name: 'チャンネル設定' }),
  ).toBeVisible()
})

/** ロールを持つ人が案内ページに迷い込んでも、そこで足止めされない（リダイレクトの往復も無い） */
test('staff が /admin/no-access を開くと管理画面へ戻される', async ({ page }) => {
  await page.goto('/admin/no-access')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'ダッシュボード', level: 1 })).toBeVisible()
})

test('staff でもダッシュボードと一覧は閲覧できる', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'ダッシュボード', level: 1 })).toBeVisible()
  await page.goto('/admin/reports')
  await expect(page.getByRole('heading', { name: 'レポート管理', level: 1 })).toBeVisible()
})
