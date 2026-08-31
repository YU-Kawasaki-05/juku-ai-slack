/** @file
 * 検証: スレッド履歴の読込（person_id フィルタ・並び順・しっぽの切り方）と保存の冪等性
 * @verifies FR-03, BR-05-11, A-4, A-9, A-12, A-13
 */
import { describe, it, expect, vi } from 'vitest'
import {
  loadThreadHistory,
  loadMessageRange,
  loadThreadTail,
  loadPrecedingAssistantText,
  saveMessage,
} from './threadHistory'
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

  it('created_at に id のタイブレーカを付ける（A-13: 同時 INSERT でのページ境界事故防止）', async () => {
    const db = createMockDb({ thenable: { data: [], error: null } })
    await loadThreadHistory(db, 'C1', '100.1', 'p1')
    expect(db.__calls.order).toEqual([
      ['created_at', false],
      ['id', false],
    ])
  })

  it('excludeMessageTs を渡すと当該メッセージを履歴から外す（A-4: 今回の質問の二重化防止）', async () => {
    const db = createMockDb({ thenable: { data: [], error: null } })
    await loadThreadHistory(db, 'C1', '100.1', 'p1', 20, '100.9')
    expect(db.__calls.neq).toContainEqual(['message_ts', '100.9'])
  })
})

describe('loadMessageRange', () => {
  it('古い順 + id タイブレークで offset/limit の窓を取る（A-13）', async () => {
    const db = createMockDb({ thenable: { data: [], error: null } })
    await loadMessageRange(db, 'C1', '100.1', 'p1', 10, 30)
    expect(db.__calls.order).toEqual([
      ['created_at', true],
      ['id', true],
    ])
    expect(db.__calls.range).toEqual([[10, 39]])
  })
})

describe('loadThreadTail（A-12: しっぽは新しい側を優先）', () => {
  function tailDb(total: number) {
    const db = createMockDb({ thenable: { data: [], error: null, count: total } })
    // countThreadMessages は { count } を読む
    return db
  }

  it('しっぽが上限以内なら要約済み接頭辞の直後から読む', async () => {
    const db = tailDb(35) // summarized=10 → tail=25 <= 30
    await loadThreadTail(db, 'C1', '100.1', 'p1', 10, 30)
    expect(db.__calls.range).toEqual([[10, 39]])
  })

  it('しっぽが上限を超えたら新しい方から上限件を読む（直近が落ちない）', async () => {
    const db = tailDb(60) // summarized=10 → tail=50 > 30
    await loadThreadTail(db, 'C1', '100.1', 'p1', 10, 30)
    // offset=10 のままだと 10..39（＝古い側）になり直近 20 件が落ちる
    expect(db.__calls.range).toEqual([[30, 59]])
  })

  it('総数が上限未満でも要約済み接頭辞より前には遡らない', async () => {
    const db = tailDb(12)
    await loadThreadTail(db, 'C1', '100.1', 'p1', 10, 30)
    expect(db.__calls.range).toEqual([[10, 39]])
  })
})

describe('loadPrecedingAssistantText（A-9）', () => {
  it('当該メッセージより前の assistant 発言を新しい順で1件引く', async () => {
    const db = createMockDb({ thenable: { data: [{ text: 'Q?', message_ts: '100.5' }], error: null } })
    const text = await loadPrecedingAssistantText(db, 'C1', '100.1', 'p1', '100.9')
    expect(text).toBe('Q?')
    expect(db.__calls.eq).toContainEqual(['role', 'assistant'])
    // 「未来の回答」を拾わないよう message_ts で上限を切る
    expect(db.__calls.lt).toContainEqual(['message_ts', '100.9'])
    expect(db.__calls.order).toEqual([['message_ts', false]])
  })

  it('該当なしは null', async () => {
    const db = createMockDb({ thenable: { data: [], error: null } })
    expect(await loadPrecedingAssistantText(db, 'C1', '100.1', 'p1', '100.9')).toBeNull()
  })
})

describe('saveMessage', () => {
  it('自然キーで upsert する（A-4: リトライで重複行を作らない）', async () => {
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
    const row = db.__calls.upsert[0] as Record<string, unknown>
    expect(row.role).toBe('user')
    expect(row.person_id).toBe('p1')
    expect(row.text).toBe('hi')
    expect(db.__calls.upsertOptions[0]).toEqual({
      onConflict: 'slack_channel_id,thread_ts,message_ts,role',
    })
    // insert は使わない（重複行の発生源）
    expect(db.__calls.insert).toHaveLength(0)
  })

  it('DB エラーは伝播する', async () => {
    const db = createMockDb({ thenable: { error: { message: 'boom' } } })
    await expect(
      saveMessage(db, {
        teamId: 'T1',
        channelId: 'C1',
        threadTs: '100.1',
        messageTs: '100.1',
        role: 'user',
        text: 'hi',
      }),
    ).rejects.toBeTruthy()
  })
})

describe('createMockDb の order 記録', () => {
  it('order 呼び出しが記録される（テスト補助の健全性）', () => {
    const db = createMockDb({})
    expect(vi.isMockFunction(db.__builder.order)).toBe(true)
  })
})
