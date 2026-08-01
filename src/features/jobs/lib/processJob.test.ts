/** @file
 * 検証: ジョブの claim・リトライ・状態遷移・二重処理防止・🤔リアクション
 * @verifies AC-04-02, AC-04-03, AC-04-04, AC-01-06, A-3, A-11
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const slackMocks = vi.hoisted(() => ({ postMessage: vi.fn(), addReaction: vi.fn(), removeReaction: vi.fn() }))
vi.mock('@shared/lib/slack/client', () => ({
  postMessage: slackMocks.postMessage,
  addReaction: slackMocks.addReaction,
  removeReaction: slackMocks.removeReaction,
}))

import { processJob, retryDelayMs } from './processJob'
import { createMockDb } from '@/test/mocks/supabaseMock'
import {
  JOB_RETRY_BASE_DELAY_MS,
  JOB_RETRY_RATE_LIMIT_BASE_DELAY_MS,
  THINKING_REACTION,
} from '@shared/lib/constants'
import {
  AiRateLimitedError,
  AiTimeoutError,
  ConfigurationError,
  LowConfidenceSkipError,
  SlackPostFailedError,
  TokenBudgetExceededError,
} from '@shared/lib/errors/AppError'
import { getUserFacingMessage } from '@shared/lib/errors/userMessages'
import type { ProcessSlackMessagePayload } from '../types'
import type { ExecuteContext } from './executeProcessMessage'

const validPayload: ProcessSlackMessagePayload = {
  teamId: 'T1',
  channelId: 'C1',
  messageTs: '100.1',
  threadTs: '100.1',
  userId: 'U1',
  text: 'hi',
  personId: '00000000-0000-0000-0000-000000000001',
  reportId: null,
  eventId: 'Ev1',
}

function claimedJob(overrides: Record<string, unknown> = {}) {
  return { id: 'job1', payload: validPayload, max_attempts: 3, status: 'processing', ...overrides }
}

const clock = () => '2026-07-03T00:00:00.000Z'

function makeOptions(
  execute: (db: unknown, p: ProcessSlackMessagePayload, ctx: ExecuteContext) => Promise<void>,
  reactionOverrides: { add?: () => Promise<unknown>; remove?: () => Promise<unknown> } = {},
) {
  const addReactionFn = vi.fn(reactionOverrides.add ?? (async () => ({ ok: true })))
  const removeReactionFn = vi.fn(reactionOverrides.remove ?? (async () => ({ ok: true })))
  const sleep = vi.fn(async () => {})
  return {
    options: {
      execute: execute as never,
      sleep,
      clock,
      addReactionFn: addReactionFn as never,
      removeReactionFn: removeReactionFn as never,
    },
    addReactionFn,
    removeReactionFn,
    sleep,
  }
}

describe('processJob', () => {
  beforeEach(() => {
    slackMocks.postMessage.mockReset()
    slackMocks.postMessage.mockResolvedValue({ ts: 'x' })
  })

  it('claim できない（既に処理済み）なら skipped（AC-04-04）', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: null } })
    const execute = vi.fn(async () => {})
    const { options } = makeOptions(execute)
    const result = await processJob(db, 'job1', options)
    expect(result.status).toBe('skipped')
    expect(execute).not.toHaveBeenCalled()
  })

  it('claim は status=pending の行のみを条件付き更新する（AC-04-04）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob(), error: null } })
    const { options } = makeOptions(vi.fn(async () => {}))
    await processJob(db, 'job1', options)
    // claim クエリが id と status=pending で絞っている
    expect(db.__calls.eq).toContainEqual(['id', 'job1'])
    expect(db.__calls.eq).toContainEqual(['status', 'pending'])
    // 最初の update は processing へ
    expect(db.__calls.update[0]).toMatchObject({ status: 'processing' })
  })

  it('正常処理で completed（AC-04-02）+ 🤔 の付与/削除（AC-01-06）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob(), error: null } })
    const { options, addReactionFn, removeReactionFn } = makeOptions(vi.fn(async () => {}))
    const result = await processJob(db, 'job1', options)

    expect(result.status).toBe('completed')
    expect(result.attempts).toBe(1)
    const last = db.__calls.update.at(-1) as Record<string, unknown>
    expect(last.status).toBe('completed')

    // 🤔 は受信メッセージ(messageTs)に付与され、完了後に削除される
    expect(addReactionFn).toHaveBeenCalledWith({
      channel: 'C1',
      timestamp: '100.1',
      name: THINKING_REACTION,
    })
    expect(removeReactionFn).toHaveBeenCalledWith({
      channel: 'C1',
      timestamp: '100.1',
      name: THINKING_REACTION,
    })
  })

  it('リアクション付与が失敗しても処理は継続する（BR-01-06 サイレント）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob(), error: null } })
    const { options } = makeOptions(vi.fn(async () => {}), {
      add: async () => {
        throw new Error('slack down')
      },
      remove: async () => {
        throw new Error('slack down')
      },
    })
    const result = await processJob(db, 'job1', options)
    expect(result.status).toBe('completed')
  })

  it('1回失敗→2回目成功でリトライして completed（AC-04-03）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob(), error: null } })
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined)
    const { options, sleep } = makeOptions(execute)
    const result = await processJob(db, 'job1', options)
    expect(result.status).toBe('completed')
    expect(result.attempts).toBe(2)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('max_attempts 到達で failed + ai_error_logs 記録（AC-04-03）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob({ max_attempts: 2 }), error: null } })
    const execute = vi.fn(async () => {
      throw new Error('always fails')
    })
    const { options } = makeOptions(execute)
    const result = await processJob(db, 'job1', options)
    expect(result.status).toBe('failed')
    expect(result.attempts).toBe(2)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(
      db.__calls.update.find((u) => (u as Record<string, unknown>).status === 'failed'),
    ).toBeTruthy()
    expect(db.__calls.insert.length).toBeGreaterThan(0)
  })

  it('execute 成功後に completed 更新が失敗しても execute を再実行しない（二重返信防止）', async () => {
    // completed 更新(thenable)を失敗させても、execute は1回だけ
    const db = createMockDb({
      maybeSingle: { data: claimedJob(), error: null },
      thenable: { error: { message: 'update failed' } },
    })
    const execute = vi.fn(async () => {})
    const { options } = makeOptions(execute)
    const result = await processJob(db, 'job1', options)
    expect(execute).toHaveBeenCalledOnce()
    expect(result.status).toBe('completed')
  })

  it('最終失敗が非サイレントエラーならユーザー向け文言を Slack に返す（FR-05）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob({ max_attempts: 1 }), error: null } })
    const execute = vi.fn(async () => {
      throw new AiRateLimitedError()
    })
    const result = await processJob(db, 'job1', makeOptions(execute).options)
    expect(result.status).toBe('failed')
    expect(slackMocks.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C1', text: getUserFacingMessage('AI_RATE_LIMITED') }),
    )
  })

  it('最終失敗がサイレントエラーなら Slack に返信しない', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob({ max_attempts: 1 }), error: null } })
    const execute = vi.fn(async () => {
      throw new LowConfidenceSkipError() // LOW_CONFIDENCE_SKIP は SILENT
    })
    await processJob(db, 'job1', makeOptions(execute).options)
    expect(slackMocks.postMessage).not.toHaveBeenCalled()
  })

  it('payload が不正なら invalid で failed 化', async () => {
    const db = createMockDb({
      maybeSingle: { data: claimedJob({ payload: { bad: true } }), error: null },
    })
    const execute = vi.fn(async () => {})
    const { options } = makeOptions(execute)
    const result = await processJob(db, 'job1', options)
    expect(result.status).toBe('invalid')
    expect(execute).not.toHaveBeenCalled()
    expect(
      db.__calls.update.find((u) => (u as Record<string, unknown>).status === 'failed'),
    ).toBeTruthy()
  })

  // --- A-11: 非リトライアブルエラーの即時打ち切り ---
  it.each([
    ['SLACK_POST_FAILED', () => new SlackPostFailedError()],
    ['TOKEN_BUDGET_EXCEEDED', () => new TokenBudgetExceededError()],
    ['設定不備', () => new ConfigurationError('LLM_MODEL_DEFAULT が未設定です')],
  ])('%s は 1 回で打ち切り failed（リトライしない, A-11）', async (_label, makeError) => {
    const db = createMockDb({ maybeSingle: { data: claimedJob(), error: null } })
    const execute = vi.fn(async () => {
      throw makeError()
    })
    const { options, sleep } = makeOptions(execute)
    const result = await processJob(db, 'job1', options)
    expect(result).toEqual({ status: 'failed', attempts: 1 })
    expect(execute).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
    // attempt_count は実際の試行回数（max_attempts ではない）
    const failedUpdate = db.__calls.update.find(
      (u) => (u as Record<string, unknown>).status === 'failed',
    ) as Record<string, unknown>
    expect(failedUpdate.attempt_count).toBe(1)
  })

  it('リトライアブルなエラーは従来どおり max_attempts まで試す（A-11 の回帰）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob({ max_attempts: 3 }), error: null } })
    const execute = vi.fn(async () => {
      throw new AiTimeoutError()
    })
    const { options, sleep } = makeOptions(execute)
    const result = await processJob(db, 'job1', options)
    expect(result).toEqual({ status: 'failed', attempts: 3 })
    expect(execute).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('レート制限のバックオフは通常より長い（A-11）', () => {
    expect(retryDelayMs(new AiRateLimitedError(), 1)).toBe(JOB_RETRY_RATE_LIMIT_BASE_DELAY_MS)
    expect(retryDelayMs(new AiRateLimitedError(), 2)).toBe(JOB_RETRY_RATE_LIMIT_BASE_DELAY_MS * 3)
    // 5s / 15s（従来は 500ms / 1000ms で 429 のウィンドウを抜けられなかった）
    expect(retryDelayMs(new AiRateLimitedError(), 1)).toBeGreaterThanOrEqual(5000)
    expect(retryDelayMs(new AiTimeoutError(), 1)).toBe(JOB_RETRY_BASE_DELAY_MS)
    expect(retryDelayMs(new Error('x'), 2)).toBe(JOB_RETRY_BASE_DELAY_MS * 2)
  })

  it('429 のリトライでは長いバックオフを使う（A-11）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob({ max_attempts: 2 }), error: null } })
    const execute = vi.fn(async () => {
      throw new AiRateLimitedError()
    })
    const { options, sleep } = makeOptions(execute)
    await processJob(db, 'job1', options)
    expect(sleep).toHaveBeenCalledWith(JOB_RETRY_RATE_LIMIT_BASE_DELAY_MS)
  })

  // --- A-3: 生成結果のキャッシュ ---
  it('claim した jobs.result_text を execute に渡す（再生成の回避, A-3）', async () => {
    const db = createMockDb({
      maybeSingle: { data: claimedJob({ result_text: '生成済みの回答' }), error: null },
    })
    const seen: ExecuteContext[] = []
    const execute = vi.fn(async (_db: unknown, _p: ProcessSlackMessagePayload, ctx: ExecuteContext) => {
      seen.push(ctx)
    })
    const { options } = makeOptions(execute)
    await processJob(db, 'job1', options)
    expect(seen[0]).toEqual({ jobId: 'job1', resultText: '生成済みの回答' })
  })

  it('生成済みの回答は同じ ctx でリトライに引き継がれる（A-3）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob(), error: null } })
    const seen: Array<string | null | undefined> = []
    const execute = vi.fn(async (_db: unknown, _p: ProcessSlackMessagePayload, ctx: ExecuteContext) => {
      seen.push(ctx.resultText)
      if (seen.length === 1) {
        // 生成には成功したが、その後の処理で（リトライアブルに）失敗した想定
        ctx.resultText = '生成済みの回答'
        throw new AiTimeoutError()
      }
    })
    const { options } = makeOptions(execute)
    const result = await processJob(db, 'job1', options)
    expect(result.status).toBe('completed')
    expect(seen).toEqual([null, '生成済みの回答'])
  })
})
