import { test, expect } from '@playwright/test'
import { STAFF_STATE } from './fixtures/users'
import { createPerson, createReport, deletePersons, uniqueSuffix } from './fixtures/db'
import { alert, toast } from './fixtures/ui'

/**
 * 権限境界（03_権限設計）。Server Action は URL から直接叩けるため、
 * UI の出し分けではなくサーバー側の requireAdmin が効いていることを確認する。
 * staff にもボタンは見えている状態でクリック → 日本語の拒否メッセージ、が期待動作。
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

test('staff はチャンネル紐付けを作成できない', async ({ page }) => {
  const person = await createPerson(`E2E生徒_権限紐付け_${uniqueSuffix()}`)
  personIds.push(person.id)

  await page.goto('/admin/channels/new')
  await page.getByLabel('SlackチャンネルID').fill(`C${uniqueSuffix().toUpperCase().replace(/[^A-Z0-9]/g, '0')}`)
  await page.getByLabel('ワークスペースID').fill('T0E2ETEAM')
  await page.getByLabel('生徒').click()
  await page.getByRole('option', { name: person.name }).click()
  await page.getByRole('button', { name: '紐付ける' }).click()

  await expect(alert(page)).toContainText('この操作は管理者のみ実行できます')
})

test('staff でもダッシュボードと一覧は閲覧できる', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'ダッシュボード', level: 1 })).toBeVisible()
  await page.goto('/admin/reports')
  await expect(page.getByRole('heading', { name: 'レポート管理', level: 1 })).toBeVisible()
})
