/** @file
 * 検証: スレッドセッションの作成 / 既存再利用（last_message_at のみ更新）
 * @verifies AC-03-01, AC-03-02, AC-03-03
 */
import { describe, it, expect } from 'vitest'
import { getOrCreateSession } from './getOrCreateSession'
import { createMockDb } from '@/test/mocks/supabaseMock'

const params = {
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '100.1',
  personId: 'p1',
  reportId: 'r1',
  nowIso: '2026-07-03T00:00:00.000Z',
}

describe('getOrCreateSession', () => {
  it('新規: INSERT した行を返し、全フィールドを渡す（AC-03-01）', async () => {
    const session = { id: 's1', slack_channel_id: 'C1', thread_ts: '100.1' }
    const db = createMockDb({ single: [{ data: session, error: null }] })
    const result = await getOrCreateSession(db, params)
    expect(result).toEqual(session)

    const inserted = db.__calls.insert[0] as Record<string, unknown>
    expect(inserted.slack_team_id).toBe('T1')
    expect(inserted.slack_channel_id).toBe('C1')
    expect(inserted.thread_ts).toBe('100.1')
    expect(inserted.root_message_ts).toBe('100.1')
    expect(inserted.person_id).toBe('p1')
    expect(inserted.report_id).toBe('r1')
    expect(inserted.status).toBe('active')
    expect(inserted.last_message_at).toBe(params.nowIso)
    // 新規時は UPDATE しない
    expect(db.__calls.update.length).toBe(0)
  })

  it('既存(23505衝突): last_message_at のみ更新し既存行を返す（AC-03-02, AC-03-03）', async () => {
    const existing = { id: 's-existing', status: 'closed', report_id: 'r-old', person_id: 'p1' }
    const db = createMockDb({
      single: [
        { data: null, error: { code: '23505', message: 'duplicate key' } }, // INSERT 衝突
        { data: existing, error: null }, // UPDATE 後の SELECT
      ],
    })
    const result = await getOrCreateSession(db, params)
    expect(result).toEqual(existing)

    // 更新は last_message_at のみ（status/report_id/person_id を破壊しない）
    expect(db.__calls.update[0]).toEqual({ last_message_at: params.nowIso })
    // (slack_channel_id, thread_ts) で対象を特定している
    expect(db.__calls.eq).toContainEqual(['slack_channel_id', 'C1'])
    expect(db.__calls.eq).toContainEqual(['thread_ts', '100.1'])
  })

  it('23505 以外の INSERT エラーは伝播する', async () => {
    const db = createMockDb({
      single: [{ data: null, error: { code: '55000', message: 'boom' } }],
    })
    await expect(getOrCreateSession(db, params)).rejects.toBeTruthy()
  })

  it('UPDATE 側のエラーも伝播する', async () => {
    const db = createMockDb({
      single: [
        { data: null, error: { code: '23505' } },
        { data: null, error: { message: 'update failed' } },
      ],
    })
    await expect(getOrCreateSession(db, params)).rejects.toBeTruthy()
  })
})
