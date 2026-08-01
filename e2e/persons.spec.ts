import { test, expect } from '@playwright/test'
import { ADMIN_STATE } from './fixtures/users'
import { deletePersonsByName, uniqueSuffix } from './fixtures/db'

/**
 * 生徒 CRUD（基本情報のみ）。AI 用プロフィールは別テストの担当。
 * テストごとに一意な名前を使い、afterAll で Service Role 経由で削除する。
 */
test.use({ storageState: ADMIN_STATE })

const created: string[] = []

test.afterAll(async () => {
  await deletePersonsByName(created)
})

test('生徒を新規登録すると一覧に表示される', async ({ page }) => {
  const name = `E2E生徒_登録_${uniqueSuffix()}`
  created.push(name)

  await page.goto('/admin/persons/new')
  await expect(page.getByRole('heading', { name: '新規生徒', level: 1 })).toBeVisible()

  await page.getByLabel('名前').fill(name)
  await page.getByLabel('表示名').fill('たろう')
  await page.getByLabel('学年').fill('中学2年')
  await page.getByRole('button', { name: '保存', exact: true }).click()

  await expect(page).toHaveURL(/\/admin\/persons$/)
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(row).toContainText('中学2年')
  await expect(row).toContainText('有効')
})

test('生徒の基本情報（名前・学年）を編集できる', async ({ page }) => {
  const name = `E2E生徒_編集_${uniqueSuffix()}`
  const renamed = `${name}_改`
  created.push(name, renamed)

  await page.goto('/admin/persons/new')
  await page.getByLabel('名前').fill(name)
  await page.getByLabel('学年').fill('中学1年')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/persons$/)

  await page.getByRole('link', { name }).click()
  await expect(page).toHaveURL(/\/admin\/persons\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()

  await page.getByLabel('名前').fill(renamed)
  await page.getByLabel('学年').fill('中学3年')
  await page.getByRole('button', { name: '保存', exact: true }).click()

  await expect(page).toHaveURL(/\/admin\/persons$/)
  const row = page.getByRole('row').filter({ hasText: renamed })
  await expect(row).toBeVisible()
  await expect(row).toContainText('中学3年')
})

test('名前が空だと登録できずエラーが表示される', async ({ page }) => {
  await page.goto('/admin/persons/new')
  // required 属性でブラウザが送信をブロックする
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/persons\/new$/)
  const valueMissing = await page
    .getByLabel('名前')
    .evaluate((el) => (el as HTMLInputElement).validity.valueMissing)
  expect(valueMissing).toBe(true)
})
