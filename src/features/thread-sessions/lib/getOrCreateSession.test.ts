/** @file
 * 検証: スレッドセッションの UPSERT（作成/再利用）
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
  reportId: null,
  nowIso: '2026-07-03T00:00:00.000Z',
}

describe('getOrCreateSession', () => {
  it('セッション行を返す', async () => {
    const session = { id: 's1', slack_channel_id: 'C1', thread_ts: '100.1', person_id: 'p1' }
    const db = createMockDb({ single: { data: session, error: null } })
    const result = await getOrCreateSession(db, params)
    expect(result.id).toBe('s1')
  })

  it('upsert に一意キー (channel, thread_ts) と person_id を渡す（AC-03-01/03）', async () => {
    const db = createMockDb({ single: { data: { id: 's1' }, error: null } })
    await getOrCreateSession(db, params)
    const upserted = db.__calls.upsert[0] as Record<string, unknown>
    expect(upserted.slack_channel_id).toBe('C1')
    expect(upserted.thread_ts).toBe('100.1')
    expect(upserted.root_message_ts).toBe('100.1')
    expect(upserted.person_id).toBe('p1')
    expect(upserted.status).toBe('active')
    expect(upserted.last_message_at).toBe(params.nowIso)
  })

  it('DB エラーは伝播する', async () => {
    const db = createMockDb({ single: { data: null, error: { message: 'boom' } } })
    await expect(getOrCreateSession(db, params)).rejects.toBeTruthy()
  })
})
