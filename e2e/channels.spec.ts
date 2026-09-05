import { test, expect } from '@playwright/test'
import { ADMIN_STATE } from './fixtures/users'
import { alert } from './fixtures/ui'
import {
  createPerson,
  deleteBindingsByChannelIds,
  deletePersons,
  uniqueSuffix,
} from './fixtures/db'

/**
 * チャンネル紐付け（FR-07）。channel_id が信頼の基点なので、
 * 形式チェックと UNIQUE 制約（重複登録の日本語エラー）を確認する。
 * 保存は必ず確認ダイアログを経由する（権限設計 3.1 の防御 1）。
 */
test.use({ storageState: ADMIN_STATE })

/** Slack のチャンネル ID は [CGD][A-Z0-9]+。E2E 用に衝突しない値を作る */
function channelId(): string {
  return `C${uniqueSuffix().toUpperCase().replace(/[^A-Z0-9]/g, '0')}`
}

const personIds: string[] = []
const channelIds: string[] = []

test.afterAll(async () => {
  await deleteBindingsByChannelIds(channelIds)
  await deletePersons(personIds)
})

async function fillBinding(
  page: import('@playwright/test').Page,
  args: { channel: string; team?: string; name?: string; person: string },
): Promise<void> {
  await page.goto('/admin/channels/new')
  await expect(page.getByRole('heading', { name: '新規チャンネル紐付け', level: 1 })).toBeVisible()
  await page.getByLabel('SlackチャンネルID').fill(args.channel)
  await page.getByLabel('ワークスペースID').fill(args.team ?? 'T0E2ETEAM')
  if (args.name) await page.getByLabel('チャンネル名').fill(args.name)
  await page.getByLabel('生徒').click()
  await page.getByRole('option', { name: args.person }).click()
}

/** 「紐付ける」は確認ダイアログを開くだけ。実際の保存はダイアログの確定ボタン */
async function confirmBinding(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: '紐付ける' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '紐付けを確定する' }).click()
}

test('生徒を選んでチャンネルを紐付けると一覧に表示される', async ({ page }) => {
  const person = await createPerson(`E2E生徒_紐付け_${uniqueSuffix()}`)
  personIds.push(person.id)
  const channel = channelId()
  channelIds.push(channel)

  await fillBinding(page, { channel, name: 'e2e-study', person: person.name })
  await confirmBinding(page)

  await expect(page).toHaveURL(/\/admin\/channels$/)
  const row = page.getByRole('row').filter({ hasText: channel })
  await expect(row).toBeVisible()
  await expect(row).toContainText('#e2e-study')
  await expect(row).toContainText(person.name)
  await expect(row).toContainText('有効')
})

test('同じチャンネルIDを二重登録すると日本語エラーで拒否される', async ({ page }) => {
  const person = await createPerson(`E2E生徒_重複_${uniqueSuffix()}`)
  personIds.push(person.id)
  const channel = channelId()
  channelIds.push(channel)

  await fillBinding(page, { channel, person: person.name })
  await confirmBinding(page)
  await expect(page).toHaveURL(/\/admin\/channels$/)

  await fillBinding(page, { channel, person: person.name })
  await confirmBinding(page)

  await expect(alert(page)).toContainText('このチャンネルはすでに紐付けされています')
  await expect(page).toHaveURL(/\/admin\/channels\/new$/)
})

test('チャンネルIDの形式が不正だとフィールドエラーになる', async ({ page }) => {
  const person = await createPerson(`E2E生徒_形式_${uniqueSuffix()}`)
  personIds.push(person.id)

  await fillBinding(page, { channel: 'not-a-channel', person: person.name })
  await confirmBinding(page)

  await expect(alert(page)).toContainText('入力内容を確認してください')
  await expect(page.locator('#slackChannelId-error')).toHaveText(
    'チャンネルIDの形式が正しくありません（例: C01ABCDEFGH）',
  )
  await expect(page).toHaveURL(/\/admin\/channels\/new$/)
})
