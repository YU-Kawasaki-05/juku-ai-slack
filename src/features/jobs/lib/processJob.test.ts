/** @file
 * 検証: ジョブの claim・リトライ・状態遷移・二重処理防止・🤔リアクション
 * @verifies AC-04-02, AC-04-03, AC-04-04, AC-01-06
 */
import { describe, it, expect, vi } from 'vitest'
import { processJob } from './processJob'
import { createMockDb } from '@/test/mocks/supabaseMock'
import { THINKING_REACTION } from '@shared/lib/constants'
import type { ProcessSlackMessagePayload } from '../types'

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
  execute: (db: unknown, p: ProcessSlackMessagePayload) => Promise<void>,
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
})
