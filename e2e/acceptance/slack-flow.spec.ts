/** @file
 * 受け入れテスト: Slack イベント受信 → ジョブ → LLM → Slack 返信の全経路（AT-30 系）
 * @verifies FR-01, FR-02, FR-03, FR-04, FR-05, FR-12, FR-19, AC-01-02, AC-01-04, AC-01-06,
 *   AC-02-02, AC-02-03, AC-02-05, AC-02-06, AC-12-01, C-3, A-15/G-3, H-6
 *
 * 外部 API は e2e/acceptance/mock-server.mjs が受ける（実 Slack / 実 LLM は 1 回も呼ばない）。
 */
import { test, expect } from '@playwright/test'
import { ADMIN_STATE } from '../fixtures/users'
import { createPerson, deletePersons, uniqueSuffix } from '../fixtures/db'
import { acquireSharedLock, KILL_SWITCH_LOCK } from '../fixtures/lock'
import {
  buildEventCallback,
  cleanupChannels,
  cleanupPersonData,
  createBinding,
  expectNoMockCalls,
  findErrorLogs,
  findJobByEventId,
  mockCalls,
  postSlackEvent,
  postedTexts,
  setPersonStatus,
  shot,
  shotErrorDetail,
  waitForMockCalls,
  withMention,
} from './fixtures'

test.use({ storageState: ADMIN_STATE })

const personIds: string[] = []
const channelIds: string[] = []

/**
 * ここは「kill_switch が稼働中」であることを前提に LLM が呼ばれることを確認する spec。
 * kill_switch を停止するテスト（e2e/kill-switch.spec.ts / acceptance/kill-switch-rate-limit.spec.ts）と
 * 同時に走ると AI_PAUSED が返って偽 FAIL になるため、共有ロックで書き手を締め出す。
 * 共有なので slack-flow 同士は従来どおり並列に走る。
 */
let releaseLock: (() => void) | undefined

test.beforeAll(async () => {
  releaseLock = await acquireSharedLock(KILL_SWITCH_LOCK)
})

test.afterAll(async () => {
  await cleanupChannels(channelIds)
  await cleanupPersonData(personIds)
  await deletePersons(personIds)
  releaseLock?.()
})

/** テストごとに衝突しないチャンネル ID（`^[CGD][A-Z0-9]+$`）を作る */
function newChannelId(tag: string): string {
  const id = `C${tag}${uniqueSuffix()}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40)
  channelIds.push(id)
  return id
}

async function newBoundPerson(label: string, tag: string) {
  const person = await createPerson(`AT ${label} ${uniqueSuffix()}`)
  personIds.push(person.id)
  const channelId = newChannelId(tag)
  await createBinding({ channelId, personId: person.id })
  return { person, channelId }
}

/**
 * Slack の ts 形式（秒.マイクロ秒）。実 Slack と同じく時刻順に単調増加させる。
 * 会話ログの並びは message_ts 順なので、乱数にすると質問と回答が入れ替わって見える。
 */
let tsCounter = 0
function nowTs(): string {
  const now = Date.now()
  tsCounter = (tsCounter + 1) % 1000
  return `${Math.floor(now / 1000)}.${String((now % 1000) * 1000 + tsCounter).padStart(6, '0')}`
}

/* ------------------------------------------------------------------------- */

test('AT-30 メンション質問がジョブ経由で LLM に渡り、生成回答が Slack に投稿される', async ({
  request,
  page,
}) => {
  const { person, channelId } = await newBoundPerson('フルフロー', 'FLOW')
  const marker = `AT30MARKER${uniqueSuffix()}`
  const eventId = `Ev${marker}`
  const ts = nowTs()

  const res = await postSlackEvent(
    request,
    buildEventCallback({
      eventId,
      channel: channelId,
      ts,
      text: withMention(`一次方程式の解き方を教えて ${marker}`),
    }),
  )
  // AC-01-02: ACK は 200 / {ok:true}
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ ok: true })

  // LLM モックが 1 回だけ呼ばれる（プロンプトに質問本文が載っている）
  const llm = await waitForMockCalls(request, { kind: 'llm', contains: marker })
  expect(llm).toHaveLength(1)

  // 生成回答が Slack に投稿される（= 全経路の到達点）
  const posts = await waitForMockCalls(request, { kind: 'slack', method: 'chat.postMessage', channel: channelId })
  expect(postedTexts(posts)[0]).toContain('モックLLMの回答です')

  // AC-01-06 / BR-05-08a: 🤔 の付与と除去
  const added = await waitForMockCalls(request, { kind: 'slack', method: 'reactions.add', channel: channelId })
  expect(added[0]?.body.name).toBe('thinking_face')
  const removed = await waitForMockCalls(request, { kind: 'slack', method: 'reactions.remove', channel: channelId })
  expect(removed[0]?.body.name).toBe('thinking_face')

  // AC-04-02: ジョブが completed で閉じている
  const job = await findJobByEventId(eventId)
  expect(job?.status).toBe('completed')

  // FR-19: 会話ログに質問と回答が時系列で残る（人が確認できる証拠）
  await page.goto('/admin/conversations')
  await expect(page.getByRole('heading', { name: '会話ログ' })).toBeVisible()
  await page.getByRole('link', { name: new RegExp(person.name.slice(0, 12)) }).first().click()
  await expect(page.getByText('一次方程式の解き方を教えて', { exact: false })).toBeVisible()
  await expect(page.getByText('モックLLMの回答です', { exact: false })).toBeVisible()
  await shot(page, 'AT-30_Slackフルフロー_会話ログ詳細')
})

test('AT-31 同じ event_id の再送では LLM を二度呼ばない（重複排除）', async ({ request }) => {
  const { channelId } = await newBoundPerson('重複', 'DUP')
  const marker = `AT31MARKER${uniqueSuffix()}`
  const eventId = `Ev${marker}`
  const body = buildEventCallback({
    eventId,
    channel: channelId,
    ts: nowTs(),
    text: withMention(`重複テスト ${marker}`),
  })

  expect((await postSlackEvent(request, body)).status()).toBe(200)
  await waitForMockCalls(request, { kind: 'llm', contains: marker })

  // AC-01-04: 2 通目は 200 だが新規処理は走らない
  expect((await postSlackEvent(request, body)).status()).toBe(200)
  await new Promise((r) => setTimeout(r, 3_000))

  expect(await mockCalls(request, { kind: 'llm', contains: marker })).toHaveLength(1)
  const logs = await findErrorLogs(channelId)
  expect(logs.some((l) => l.error_code === 'SLACK_EVENT_DUPLICATE')).toBeTruthy()
})

test('AT-32 未紐付けチャンネルには案内文言だけを返し LLM を呼ばない', async ({ request, page }) => {
  const channelId = newChannelId('NOBIND')
  const marker = `AT32MARKER${uniqueSuffix()}`

  const res = await postSlackEvent(
    request,
    buildEventCallback({
      eventId: `Ev${marker}`,
      channel: channelId,
      ts: nowTs(),
      text: withMention(`紐付けなし ${marker}`),
    }),
  )
  expect(res.status()).toBe(200)

  // AC-02-06 / BR-02-05
  const posts = await waitForMockCalls(request, { kind: 'slack', method: 'chat.postMessage', channel: channelId })
  expect(postedTexts(posts)[0]).toContain('まだBotの設定が完了していない')
  expect(await mockCalls(request, { kind: 'llm', contains: marker })).toHaveLength(0)

  const logs = await findErrorLogs(channelId)
  expect(logs.some((l) => l.error_code === 'CHANNEL_NOT_BOUND')).toBeTruthy()
  await shotErrorDetail(page, {
    channelId,
    code: 'CHANNEL_NOT_BOUND',
    name: 'AT-32_未紐付けチャンネルの案内とエラー記録',
  })
})

test('AT-33 チャンネル直下でメンションが無ければ完全に無反応', async ({ request }) => {
  const { channelId } = await newBoundPerson('無反応', 'NOMENT')
  const marker = `AT33MARKER${uniqueSuffix()}`

  const res = await postSlackEvent(
    request,
    buildEventCallback({
      eventId: `Ev${marker}`,
      channel: channelId,
      ts: nowTs(),
      text: `スタッフ同士の雑談 ${marker}`,
    }),
  )
  expect(res.status()).toBe(200)

  // AC-02-02: Slack 投稿もリアクションも LLM 呼び出しも発生しない
  await expectNoMockCalls(request, { kind: 'slack', channel: channelId })
  expect(await mockCalls(request, { kind: 'llm', contains: marker })).toHaveLength(0)
})

test('AT-34 退塾生（persons.status=inactive）のチャンネルには一切投稿しない', async ({ request }) => {
  const person = await createPerson(`AT 退塾 ${uniqueSuffix()}`)
  personIds.push(person.id)
  const channelId = newChannelId('INACT')
  await createBinding({ channelId, personId: person.id })
  await setPersonStatus(person.id, 'inactive')

  const marker = `AT34MARKER${uniqueSuffix()}`
  const res = await postSlackEvent(
    request,
    buildEventCallback({
      eventId: `Ev${marker}`,
      channel: channelId,
      ts: nowTs(),
      text: withMention(`退塾生の質問 ${marker}`),
    }),
  )
  expect(res.status()).toBe(200)

  // H-6: 案内すら投稿しない（無言 ignore）。ただし運用で気づけるよう info ログは残る
  await expectNoMockCalls(request, { kind: 'slack', channel: channelId })
  const logs = await findErrorLogs(channelId)
  expect(logs.some((l) => l.error_code === 'PERSON_INACTIVE')).toBeTruthy()
})

test('AT-35 LLM 出力の <!channel> はエスケープされて投稿される（C-3 通知インジェクション）', async ({
  request,
}) => {
  const { channelId } = await newBoundPerson('エスケープ', 'ESC')
  const marker = `AT35MARKER${uniqueSuffix()}`

  await postSlackEvent(
    request,
    buildEventCallback({
      eventId: `Ev${marker}`,
      channel: channelId,
      ts: nowTs(),
      // モック LLM に <!channel> 入りの回答を返させる
      text: withMention(`[[MOCK:INJECT]] ${marker}`),
    }),
  )

  const posts = await waitForMockCalls(request, { kind: 'slack', method: 'chat.postMessage', channel: channelId })
  const text = postedTexts(posts)[0]
  expect(text).toContain('&lt;!channel&gt;')
  expect(text).not.toContain('<!channel>')
})

test('AT-36 出力トークン上限で切れた回答には続きの案内が付く（A-15 / G-3）', async ({ request }) => {
  const { channelId } = await newBoundPerson('打ち切り', 'TRUNC')
  const marker = `AT36MARKER${uniqueSuffix()}`

  await postSlackEvent(
    request,
    buildEventCallback({
      eventId: `Ev${marker}`,
      channel: channelId,
      ts: nowTs(),
      text: withMention(`[[MOCK:TRUNCATE]] ${marker}`),
    }),
  )

  const posts = await waitForMockCalls(request, { kind: 'slack', method: 'chat.postMessage', channel: channelId })
  expect(postedTexts(posts)[0]).toContain('文字数の上限で途中までになっちゃった')
})

test('AT-37 登録済みスレッド内はメンション無しでも反応する（AC-02-03）', async ({ request }) => {
  const { channelId } = await newBoundPerson('スレッド', 'THREAD')
  const rootTs = nowTs()
  const first = `AT37ROOT${uniqueSuffix()}`

  // 1 通目: メンションでスレッドを登録する
  await postSlackEvent(
    request,
    buildEventCallback({ eventId: `Ev${first}`, channel: channelId, ts: rootTs, text: withMention(`最初の質問 ${first}`) }),
  )
  await waitForMockCalls(request, { kind: 'llm', contains: first })

  // 2 通目: 同じスレッドにメンション無しで返信
  const followUp = `AT37REPLY${uniqueSuffix()}`
  await postSlackEvent(
    request,
    buildEventCallback({
      eventId: `Ev${followUp}`,
      channel: channelId,
      ts: nowTs(),
      threadTs: rootTs,
      text: `続きを教えて ${followUp}`,
    }),
  )
  await waitForMockCalls(request, { kind: 'llm', contains: followUp })

  const posts = await waitForMockCalls(
    request,
    { kind: 'slack', method: 'chat.postMessage', channel: channelId },
    { min: 2 },
  )
  expect(posts.length).toBeGreaterThanOrEqual(2)
  // スレッド返信として投稿されている
  expect(posts.every((c) => c.body.thread_ts === rootTs)).toBeTruthy()
})

test('AT-38 Bot 自身のメッセージ（bot_id 付き）には反応しない（AC-02-05）', async ({ request }) => {
  const { channelId } = await newBoundPerson('Bot自身', 'BOTMSG')
  const marker = `AT38MARKER${uniqueSuffix()}`

  const res = await postSlackEvent(
    request,
    buildEventCallback({
      eventId: `Ev${marker}`,
      channel: channelId,
      ts: nowTs(),
      text: withMention(`Bot の発言 ${marker}`),
      botId: 'B0BOTID',
    }),
  )
  expect(res.status()).toBe(200)
  await expectNoMockCalls(request, { kind: 'slack', channel: channelId })
})

test('AT-39 LLM 障害時は内部情報を出さないユーザー向け文言を返し、エラーを記録する', async ({
  request,
  page,
}) => {
  const { channelId } = await newBoundPerson('LLM障害', 'LLMERR')
  const marker = `AT39MARKER${uniqueSuffix()}`
  const eventId = `Ev${marker}`

  await postSlackEvent(
    request,
    buildEventCallback({
      eventId,
      channel: channelId,
      ts: nowTs(),
      text: withMention(`[[MOCK:FAIL]] ${marker}`),
    }),
  )

  const posts = await waitForMockCalls(
    request,
    { kind: 'slack', method: 'chat.postMessage', channel: channelId },
    { timeoutMs: 40_000 },
  )
  const text = postedTexts(posts)[0]
  // BR-11-01 / BR-05-12: スタックトレースや内部メッセージを出さない
  expect(text).toContain('うまく処理できなかったみたい')
  expect(text).not.toContain('boom (mock)')
  expect(text).not.toMatch(/mock-llm-key|127\.0\.0\.1/)

  const job = await findJobByEventId(eventId)
  expect(job?.status).toBe('failed')
  const logs = await findErrorLogs(channelId)
  expect(logs.some((l) => l.error_code === 'AI_RESPONSE_FAILED')).toBeTruthy()
  await shotErrorDetail(page, {
    channelId,
    code: 'AI_RESPONSE_FAILED',
    name: 'AT-39_LLM障害時のエラー記録',
  })
})

test('AT-47 フルフロー後に利用量ログが記録される（FR-12）', async ({ request }) => {
  const { person, channelId } = await newBoundPerson('利用量', 'USAGE')
  const marker = `AT47MARKER${uniqueSuffix()}`

  await postSlackEvent(
    request,
    buildEventCallback({
      eventId: `Ev${marker}`,
      channel: channelId,
      ts: nowTs(),
      text: withMention(`利用量の記録 ${marker}`),
    }),
  )
  await waitForMockCalls(request, { kind: 'slack', method: 'chat.postMessage', channel: channelId })

  // AC-12-01: model / tokens / latency が入る
  const { adminDb } = await import('../fixtures/db')
  await expect
    .poll(
      async () => {
        const { data } = await adminDb()
          .from('ai_usage_logs')
          .select('*')
          .eq('person_id', person.id)
        return data?.length ?? 0
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0)

  const { data } = await adminDb().from('ai_usage_logs').select('*').eq('person_id', person.id)
  const row = data?.[0] as Record<string, unknown>
  expect(row.model).toBe('mock/tutor-model')
  expect(Number(row.input_tokens)).toBe(123)
  expect(Number(row.output_tokens)).toBe(45)
  expect(row.latency_ms).not.toBeNull()
})
