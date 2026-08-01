/** @file
 * 受け入れテスト: AI コスト・緊急停止の遮断機構（AT-40 系）
 * @verifies F-1 kill_switch / DEC-15 #alerts 通知 / F-2 per-person レート制限
 *
 * いずれも「LLM を呼ばずに定型文だけ返す」ことが要件なので、
 * モック LLM への呼び出しが 0 件であることまで確認する。
 */
import { test, expect } from '@playwright/test'
import { ADMIN_STATE } from '../fixtures/users'
import { createPerson, deletePersons, resetKillSwitch, uniqueSuffix } from '../fixtures/db'
import { acquireLock, KILL_SWITCH_LOCK } from '../fixtures/lock'
import { toast } from '../fixtures/ui'
import {
  buildEventCallback,
  cleanupChannels,
  cleanupPersonData,
  createBinding,
  findErrorLogs,
  mockCalls,
  postSlackEvent,
  postedTexts,
  setKillSwitch,
  seedUsageLogs,
  shot,
  shotErrorDetail,
  waitForMockCalls,
  withMention,
} from './fixtures'

// kill_switches はグローバル状態。e2e/kill-switch.spec.ts と同じロックで排他する
test.describe.configure({ mode: 'serial' })
test.use({ storageState: ADMIN_STATE })

let release: (() => void) | undefined
const personIds: string[] = []
const channelIds: string[] = []

test.beforeAll(async () => {
  release = await acquireLock(KILL_SWITCH_LOCK)
})

test.afterAll(async () => {
  await resetKillSwitch()
  await cleanupChannels(channelIds)
  await cleanupPersonData(personIds)
  await deletePersons(personIds)
  release?.()
})

let tsCounter = 0
function nowTs(): string {
  const now = Date.now()
  tsCounter = (tsCounter + 1) % 1000
  return `${Math.floor(now / 1000)}.${String((now % 1000) * 1000 + tsCounter).padStart(6, '0')}`
}

async function newBoundPerson(label: string, tag: string) {
  const person = await createPerson(`AT ${label} ${uniqueSuffix()}`)
  personIds.push(person.id)
  const channelId = `C${tag}${uniqueSuffix()}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40)
  channelIds.push(channelId)
  await createBinding({ channelId, personId: person.id })
  return { person, channelId }
}

/* ------------------------------------------------------------------------- */

test('AT-40 kill_switch 停止中は LLM を呼ばずメンテナンス文言だけを返す（F-1）', async ({
  request,
  page,
}) => {
  const { channelId } = await newBoundPerson('停止中', 'KILL')
  const marker = `AT40MARKER${uniqueSuffix()}`

  await setKillSwitch(false, '受け入れテスト: コスト遮断の確認')

  try {
    const res = await postSlackEvent(
      request,
      buildEventCallback({
        eventId: `Ev${marker}`,
        channel: channelId,
        ts: nowTs(),
        text: withMention(`停止中の質問 ${marker}`),
      }),
    )
    expect(res.status()).toBe(200)

    const posts = await waitForMockCalls(request, {
      kind: 'slack',
      method: 'chat.postMessage',
      channel: channelId,
    })
    expect(postedTexts(posts)[0]).toContain('いまメンテナンス中でお返事ができないんだ')

    // コスト遮断の要件: LLM は 1 回も呼ばれない
    expect(await mockCalls(request, { kind: 'llm', contains: marker })).toHaveLength(0)

    const logs = await findErrorLogs(channelId, { code: 'AI_PAUSED' })
    expect(logs.some((l) => l.error_code === 'AI_PAUSED')).toBeTruthy()
    await shotErrorDetail(page, {
      channelId,
      code: 'AI_PAUSED',
      name: 'AT-40_kill_switch停止中はLLMを呼ばない',
    })
  } finally {
    await resetKillSwitch()
  }
})

test('AT-41 管理者は管理画面から停止・再開でき、状態が表示される', async ({ page }) => {
  await resetKillSwitch()
  await page.goto('/admin')
  await expect(page.getByText('稼働中', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'AI応答を停止' }).click()
  await page.getByLabel('理由').fill('受入テスト AT-41: 緊急停止の確認')
  await page.getByRole('button', { name: '停止する' }).click()

  await expect(toast(page)).toContainText(/AI応答を停止(しました|し、)/)
  await expect(page.getByText('停止中', { exact: true })).toBeVisible()
  await expect(page.getByText('理由: 受入テスト AT-41: 緊急停止の確認')).toBeVisible()
  await shot(page, 'AT-41_kill_switch_停止中の状態表示')

  await page.getByRole('button', { name: 'AI応答を再開' }).click()
  await page.getByLabel('理由').fill('受入テスト AT-41: 復旧')
  await page.getByRole('button', { name: '再開する' }).click()
  await expect(page.getByText('稼働中', { exact: true })).toBeVisible()
})

test('AT-43 kill_switch の状態変化が #alerts に通知される（DEC-15）', async ({ page, request }) => {
  const alertsChannel = process.env.SLACK_ALERTS_CHANNEL_ID ?? 'C0E2EALERTS'
  await resetKillSwitch()

  const before = await mockCalls(request, {
    kind: 'slack',
    method: 'chat.postMessage',
    channel: alertsChannel,
  })

  await page.goto('/admin')
  await page.getByRole('button', { name: 'AI応答を停止' }).click()
  await page.getByLabel('理由').fill('受入テスト AT-43: 通知の確認')
  await page.getByRole('button', { name: '停止する' }).click()
  await expect(page.getByText('停止中', { exact: true })).toBeVisible()

  const after = await waitForMockCalls(
    request,
    { kind: 'slack', method: 'chat.postMessage', channel: alertsChannel },
    { min: before.length + 1 },
  )
  const text = postedTexts(after).at(-1) ?? ''
  expect(text).toContain('AI応答を停止しました')
  expect(text).toContain('受入テスト AT-43: 通知の確認')
  // 操作者（ログインユーザー）が分かること
  expect(text).toContain('@example.test')

  await resetKillSwitch()
})

test('AT-44 直近1時間で10回に達した生徒には定型文を返し LLM を呼ばない（F-2）', async ({
  request,
  page,
}) => {
  const { person, channelId } = await newBoundPerson('レート制限', 'RATE')
  // 上限 RATE_LIMIT_QUESTIONS_PER_HOUR = 10
  await seedUsageLogs({ personId: person.id, channelId, count: 10 })

  const marker = `AT44MARKER${uniqueSuffix()}`
  const res = await postSlackEvent(
    request,
    buildEventCallback({
      eventId: `Ev${marker}`,
      channel: channelId,
      ts: nowTs(),
      text: withMention(`11回目の質問 ${marker}`),
    }),
  )
  expect(res.status()).toBe(200)

  const posts = await waitForMockCalls(request, {
    kind: 'slack',
    method: 'chat.postMessage',
    channel: channelId,
  })
  expect(postedTexts(posts)[0]).toContain('ちょっと休憩して、1時間ほどしてからまた質問してね')
  expect(await mockCalls(request, { kind: 'llm', contains: marker })).toHaveLength(0)

  const logs = await findErrorLogs(channelId, { code: 'RATE_LIMITED' })
  expect(logs.some((l) => l.error_code === 'RATE_LIMITED')).toBeTruthy()
  await shotErrorDetail(page, {
    channelId,
    code: 'RATE_LIMITED',
    name: 'AT-44_レート制限到達時はLLMを呼ばない',
  })
})

test('AT-44b 上限未満（9回）の生徒は通常どおり回答を受け取れる', async ({ request }) => {
  const { person, channelId } = await newBoundPerson('制限内', 'RATEOK')
  await seedUsageLogs({ personId: person.id, channelId, count: 9 })

  const marker = `AT44BMARKER${uniqueSuffix()}`
  await postSlackEvent(
    request,
    buildEventCallback({
      eventId: `Ev${marker}`,
      channel: channelId,
      ts: nowTs(),
      text: withMention(`10回目の質問 ${marker}`),
    }),
  )

  const posts = await waitForMockCalls(request, {
    kind: 'slack',
    method: 'chat.postMessage',
    channel: channelId,
  })
  expect(postedTexts(posts)[0]).toContain('モックLLMの回答です')
  expect(await mockCalls(request, { kind: 'llm', contains: marker })).toHaveLength(1)
})
