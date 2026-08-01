import { test, expect } from '@playwright/test'
import { ADMIN_STATE } from './fixtures/users'
import { createPerson, deletePersons, uniqueSuffix } from './fixtures/db'
import { alert } from './fixtures/ui'

/**
 * レポート（FR-16）。下書き作成 → Embedding 警告 → 承認保存まで。
 * E2E 環境は EMBEDDING_* を設定しないので、保存時の自動 Embedding は必ず失敗し
 * 詳細ページに「Embedding 再生成が必要です」が出る（DEC-14 の警告経路の確認）。
 */
test.use({ storageState: ADMIN_STATE })

const personIds: string[] = []

test.afterAll(async () => {
  await deletePersons(personIds)
})

async function newPerson(label: string) {
  const person = await createPerson(`E2E生徒_${label}_${uniqueSuffix()}`)
  personIds.push(person.id)
  return person
}

async function fillNewReport(
  page: import('@playwright/test').Page,
  args: { person: string; month: string; title: string; body?: string },
): Promise<void> {
  await page.goto('/admin/reports/new')
  await expect(page.getByRole('heading', { name: '新規レポート', level: 1 })).toBeVisible()
  await page.getByLabel('生徒').click()
  await page.getByRole('option', { name: args.person }).click()
  await page.getByLabel('対象月').fill(args.month)
  await page.getByLabel('タイトル').fill(args.title)
  if (args.body) await page.getByLabel('本文').fill(args.body)
}

test('下書き作成 → 詳細で Embedding 警告 → 承認保存', async ({ page }) => {
  const person = await newPerson('レポート')
  const title = `E2Eレポート_${uniqueSuffix()}`

  await fillNewReport(page, {
    person: person.name,
    month: '2026-04',
    title,
    body: '# 今月の様子\n\n- 計算問題に取り組んだ',
  })
  await page.getByRole('button', { name: '下書き保存' }).click()
  await expect(page).toHaveURL(/\/admin\/reports$/)

  const row = page.getByRole('row').filter({ hasText: title })
  await expect(row).toBeVisible()
  await expect(row).toContainText('下書き')

  // 詳細: Embedding 未生成 → 再生成が必要の警告（DEC-14 / BR-16-03）
  await row.getByRole('link', { name: person.name }).click()
  await expect(page).toHaveURL(/\/admin\/reports\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  await expect(alert(page)).toContainText('Embedding 再生成が必要です')
  await expect(page.getByText('未生成')).toBeVisible()

  // 承認保存
  await page.getByRole('link', { name: '編集' }).click()
  await expect(page.getByRole('heading', { name: 'レポート編集', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: '承認して保存' }).click()

  await expect(page).toHaveURL(/\/admin\/reports$/)
  await expect(page.getByRole('row').filter({ hasText: title })).toContainText('承認済み')
})

test('タイトル入力欄で Enter を押しても承認されず下書き保存になる（H-2）', async ({ page }) => {
  const person = await newPerson('Enter')
  const title = `E2EレポートEnter_${uniqueSuffix()}`

  await fillNewReport(page, { person: person.name, month: '2026-05', title })
  await page.getByLabel('タイトル').press('Enter')

  await expect(page).toHaveURL(/\/admin\/reports$/)
  const row = page.getByRole('row').filter({ hasText: title })
  await expect(row).toContainText('下書き')
  await expect(row).not.toContainText('承認済み')
})

test('同じ生徒・同じ月のレポートは重複登録できない', async ({ page }) => {
  const person = await newPerson('重複月')
  const title = `E2Eレポート重複_${uniqueSuffix()}`

  await fillNewReport(page, { person: person.name, month: '2026-06', title })
  await page.getByRole('button', { name: '下書き保存' }).click()
  await expect(page).toHaveURL(/\/admin\/reports$/)

  await fillNewReport(page, { person: person.name, month: '2026-06', title: `${title}_2` })
  await page.getByRole('button', { name: '下書き保存' }).click()

  await expect(alert(page)).toContainText('この生徒のこの月のレポートは既に存在します')
})
