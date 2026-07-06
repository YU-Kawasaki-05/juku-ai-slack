/** @file
 * 検証: スレッド履歴の読込（person_id フィルタ・並び順）と保存
 * @verifies FR-03, BR-05-11
 */
import { describe, it, expect } from 'vitest'
import { loadThreadHistory, saveMessage } from './threadHistory'
import { createMockDb } from '@/test/mocks/supabaseMock'

describe('loadThreadHistory', () => {
  it('channel/thread/person_id で絞り、古い順に整形する', async () => {
    // DB は新しい順（DESC）で返す
    const rows = [
      { role: 'assistant', text: 'A2', created_at: '2026-07-03T00:02:00Z' },
      { role: 'user', text: 'Q2', created_at: '2026-07-03T00:01:30Z' },
      { role: 'assistant', text: 'A1', created_at: '2026-07-03T00:01:00Z' },
      { role: 'user', text: 'Q1', created_at: '2026-07-03T00:00:30Z' },
    ]
    const db = createMockDb({ thenable: { data: rows, error: null } })
    const history = await loadThreadHistory(db, 'C1', '100.1', 'p1')

    // 古い順に整形される
    expect(history.map((m) => m.content)).toEqual(['Q1', 'A1', 'Q2', 'A2'])
    // BR-05-11: person_id でも絞る
    expect(db.__calls.eq).toContainEqual(['slack_channel_id', 'C1'])
    expect(db.__calls.eq).toContainEqual(['thread_ts', '100.1'])
    expect(db.__calls.eq).toContainEqual(['person_id', 'p1'])
  })

  it('テキストなし/未知ロールは除外', async () => {
    const rows = [
      { role: 'user', text: null, created_at: '2026-07-03T00:01:00Z' },
      { role: 'user', text: 'ok', created_at: '2026-07-03T00:00:00Z' },
    ]
    const db = createMockDb({ thenable: { data: rows, error: null } })
    const history = await loadThreadHistory(db, 'C1', '100.1', 'p1')
    expect(history).toEqual([{ role: 'user', content: 'ok' }])
  })

  it('DB エラーは伝播', async () => {
    const db = createMockDb({ thenable: { data: null, error: { message: 'boom' } } })
    await expect(loadThreadHistory(db, 'C1', '100.1', 'p1')).rejects.toBeTruthy()
  })
})

describe('saveMessage', () => {
  it('slack_messages に role/text/person_id を挿入', async () => {
    const db = createMockDb({ thenable: { error: null } })
    await saveMessage(db, {
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '100.1',
      messageTs: '100.1',
      personId: 'p1',
      role: 'user',
      text: 'hi',
    })
    const row = db.__calls.insert[0] as Record<string, unknown>
    expect(row.role).toBe('user')
    expect(row.person_id).toBe('p1')
    expect(row.text).toBe('hi')
  })
})
