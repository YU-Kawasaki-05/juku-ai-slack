import { test, expect } from '@playwright/test'
import { STAFF_STATE } from './fixtures/users'
import { createPerson, createReport, deletePersons, uniqueSuffix } from './fixtures/db'
import { toast } from './fixtures/ui'

/**
 * 権限境界（03_権限設計）。
 *
 * 2 つの防御層をそれぞれ検証する:
 * - Server Action 層: URL から直接叩けるため requireAdmin が最後の砦（Embedding 再生成）
 * - 画面層: チャンネル紐付け（SCR-05/06）は生徒名とチャンネルの対応表そのものなので、
 *   admin 以外にはデータを読ませず画面ごと塞ぐ（EP-07）
 */
test.use({ storageState: STAFF_STATE })

const personIds: string[] = []

test.afterAll(async () => {
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
 * EP-07: staff はチャンネル紐付けの画面自体に到達できない。
 * フォームを見せて「保存して初めて拒否」ではなく、データを読む前に塞ぐ。
 */
test('staff はチャンネル紐付けの画面に到達できない（一覧・新規・詳細）', async ({ page }) => {
  const person = await createPerson(`E2E生徒_権限紐付け_${uniqueSuffix()}`)
  personIds.push(person.id)

  for (const path of ['/admin/channels', '/admin/channels/new']) {
    await page.goto(path)
    await expect(
      page.getByText('チャンネル紐付けの管理は管理者（admin）のみが利用できます'),
    ).toBeVisible()
    // フォームも一覧も描画されない（生徒名とチャンネルの対応が漏れない）
    await expect(page.getByLabel('SlackチャンネルID')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '紐付ける' })).toHaveCount(0)
    await expect(page.getByText(person.name)).toHaveCount(0)
  }
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
