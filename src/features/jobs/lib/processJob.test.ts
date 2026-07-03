/** @file
 * 検証: ジョブの claim・リトライ・状態遷移・二重処理防止
 * @verifies AC-04-02, AC-04-03, AC-04-04
 */
import { describe, it, expect, vi } from 'vitest'
import { processJob } from './processJob'
import { createMockDb } from '@/test/mocks/supabaseMock'
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

const noopReaction = vi.fn(async () => ({ ok: true }))
const noopSleep = vi.fn(async () => {})
const clock = () => '2026-07-03T00:00:00.000Z'

function baseOptions(execute: (db: unknown, p: ProcessSlackMessagePayload) => Promise<void>) {
  return {
    execute: execute as never,
    sleep: noopSleep,
    clock,
    addReactionFn: noopReaction as never,
    removeReactionFn: noopReaction as never,
  }
}

describe('processJob', () => {
  it('claim できない（既に処理済み）なら skipped（AC-04-04）', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: null } })
    const execute = vi.fn(async () => {})
    const result = await processJob(db, 'job1', baseOptions(execute))
    expect(result.status).toBe('skipped')
    expect(execute).not.toHaveBeenCalled()
  })

  it('正常処理で completed（AC-04-02）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob(), error: null } })
    const execute = vi.fn(async () => {})
    const result = await processJob(db, 'job1', baseOptions(execute))
    expect(result.status).toBe('completed')
    expect(result.attempts).toBe(1)
    expect(execute).toHaveBeenCalledOnce()
    // claim(processing) → completed の順で update される
    const last = db.__calls.update.at(-1) as Record<string, unknown>
    expect(last.status).toBe('completed')
    expect(db.__calls.update[0]).toMatchObject({ status: 'processing' })
    // 🤔 の付与・削除が呼ばれる
    expect(noopReaction).toHaveBeenCalled()
  })

  it('1回失敗→2回目成功でリトライして completed（AC-04-03）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob(), error: null } })
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined)
    const result = await processJob(db, 'job1', baseOptions(execute))
    expect(result.status).toBe('completed')
    expect(result.attempts).toBe(2)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(noopSleep).toHaveBeenCalledOnce() // 1回だけバックオフ
  })

  it('max_attempts 到達で failed（AC-04-03）', async () => {
    const db = createMockDb({ maybeSingle: { data: claimedJob({ max_attempts: 2 }), error: null } })
    const execute = vi.fn(async () => {
      throw new Error('always fails')
    })
    const result = await processJob(db, 'job1', baseOptions(execute))
    expect(result.status).toBe('failed')
    expect(result.attempts).toBe(2)
    expect(execute).toHaveBeenCalledTimes(2)
    const failedUpdate = db.__calls.update.find(
      (u) => (u as Record<string, unknown>).status === 'failed',
    )
    expect(failedUpdate).toBeTruthy()
    // ai_error_logs への記録（insert）が行われる
    expect(db.__calls.insert.length).toBeGreaterThan(0)
  })

  it('payload が不正なら invalid で failed 化', async () => {
    const db = createMockDb({
      maybeSingle: { data: claimedJob({ payload: { bad: true } }), error: null },
    })
    const execute = vi.fn(async () => {})
    const result = await processJob(db, 'job1', baseOptions(execute))
    expect(result.status).toBe('invalid')
    expect(execute).not.toHaveBeenCalled()
    const failedUpdate = db.__calls.update.find(
      (u) => (u as Record<string, unknown>).status === 'failed',
    )
    expect(failedUpdate).toBeTruthy()
  })
})
