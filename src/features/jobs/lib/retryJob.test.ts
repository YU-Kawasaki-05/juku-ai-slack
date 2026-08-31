/** @file
 * 検証: failed ジョブ再実行の二重返信ガード（配信済み判定）と状態遷移
 * @verifies F-4, A-3
 */
import { describe, it, expect } from 'vitest'
import { createQueuedDb } from '@/test/mocks/queuedDb'
import { retryJob } from './retryJob'

const NOW = new Date('2026-08-02T12:00:00.000Z')
const JOB_ID = '11111111-1111-4111-8111-111111111111'

const payload = {
  teamId: 'T1',
  channelId: 'C1',
  messageTs: '1754100000.000100',
  threadTs: '1754100000.000100',
  userId: 'U1',
  text: '因数分解を教えて',
  personId: '00000000-0000-0000-0000-000000000001',
  reportId: null,
  eventId: 'Ev1',
}

function failedJob(overrides: Record<string, unknown> = {}) {
  return { data: { id: JOB_ID, status: 'failed', payload, ...overrides }, error: null }
}

describe('retryJob', () => {
  it('存在しないジョブは not_found', async () => {
    const db = createQueuedDb([{ data: null, error: null }])
    expect(await retryJob(db, JOB_ID, NOW)).toEqual({ kind: 'not_found' })
  })

  it('failed 以外は再実行しない（processing 中の横取り防止）', async () => {
    const db = createQueuedDb([failedJob({ status: 'processing' })])
    expect(await retryJob(db, JOB_ID, NOW)).toEqual({ kind: 'not_retryable', status: 'processing' })
    // 状態を書き換えていない
    expect(db.__queries.filter((q) => q.op === 'update')).toHaveLength(0)
  })

  it('payload が不正なら再実行しない', async () => {
    const db = createQueuedDb([failedJob({ payload: { channelId: 'C1' } })])
    expect(await retryJob(db, JOB_ID, NOW)).toEqual({ kind: 'invalid_payload' })
    expect(db.__queries.filter((q) => q.op === 'update')).toHaveLength(0)
  })

  it('二重返信ガード: 質問より後の assistant 行があれば再実行せず completed に確定する', async () => {
    const db = createQueuedDb([
      failedJob(),
      { data: [{ id: 'm1' }], error: null }, // 配信済み
      { data: [{ id: JOB_ID }], error: null },
    ])

    expect(await retryJob(db, JOB_ID, NOW)).toEqual({ kind: 'already_delivered' })

    const [, messages, update] = db.__queries
    expect(messages.table).toBe('slack_messages')
    expect(messages.filterValue('eq', 'slack_channel_id')).toBe('C1')
    expect(messages.filterValue('eq', 'thread_ts')).toBe(payload.threadTs)
    expect(messages.filterValue('eq', 'role')).toBe('assistant')
    // 「当該質問の message_ts より後」の assistant 行だけを見る
    expect(messages.filterValue('gt', 'message_ts')).toBe(payload.messageTs)
    expect(update.values).toEqual({ status: 'completed', finished_at: NOW.toISOString() })
    expect(update.filterValue('eq', 'status')).toBe('failed')
  })

  it('assistant 行が無ければ pending に差し戻し attempt をリセットする', async () => {
    const db = createQueuedDb([
      failedJob(),
      { data: [], error: null }, // 未配信
      { data: [{ id: JOB_ID }], error: null },
    ])

    expect(await retryJob(db, JOB_ID, NOW)).toEqual({ kind: 'requeued' })

    const update = db.__queries[2]
    expect(update.values).toEqual({
      status: 'pending',
      attempt_count: 0,
      started_at: null,
      finished_at: null,
      error_code: null,
      scheduled_at: NOW.toISOString(),
    })
    // A-3: 生成済みの回答は消さない（再実行は配信のみで済む）
    expect(Object.keys(update.values as object)).not.toContain('result_text')
    expect(update.filterValue('eq', 'status')).toBe('failed')
  })

  it('CAS が 0 行なら conflict（他操作と競合したので再実行しない）', async () => {
    const db = createQueuedDb([
      failedJob(),
      { data: [], error: null },
      { data: [], error: null }, // 差し戻し UPDATE が 0 行
    ])
    expect(await retryJob(db, JOB_ID, NOW)).toEqual({ kind: 'conflict' })
  })

  it('配信済み判定の DB エラーは伝播する（不明なまま再実行しない）', async () => {
    const db = createQueuedDb([failedJob(), { data: null, error: { message: 'select boom' } }])
    await expect(retryJob(db, JOB_ID, NOW)).rejects.toThrow(/select boom/)
  })
})
