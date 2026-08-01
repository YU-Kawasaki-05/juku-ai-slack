/** @file
 * 検証: 会話ログの一覧取得（RPC 集計への移行）と純関数（行整形・期間境界・時刻整形）
 * @verifies FR-19, H-3, E-4, G-8
 */
import { describe, it, expect } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'
import {
  mapThreadRows,
  conversationRangeFromIso,
  formatMessageTime,
  getThreads,
  getUsedModels,
  CONVERSATION_PAGE_SIZE,
  type ThreadListRow,
} from './getConversations'

function row(partial: Partial<ThreadListRow> = {}): ThreadListRow {
  return {
    id: 's1',
    slack_team_id: 'T1',
    slack_channel_id: 'C1',
    root_message_ts: '100.1',
    thread_ts: '100.1',
    person_id: 'p1',
    report_id: null,
    status: 'active',
    thread_summary: null,
    summary_message_count: 0,
    created_at: '2026-07-08T00:00:00Z',
    updated_at: '2026-07-08T00:00:00Z',
    last_message_at: '2026-07-08T03:00:00Z',
    person_name: '山田太郎',
    channel_name: 'study-taro',
    message_count: 4,
    has_image: true,
    has_error: false,
    models: ['deepseek-chat'],
    total_count: 1,
    ...partial,
  }
}

describe('mapThreadRows', () => {
  it('RPC の平坦な行を画面用の形に整える', () => {
    const { items, total } = mapThreadRows([row()])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 's1',
      persons: { name: '山田太郎' },
      channelName: 'study-taro',
      messageCount: 4,
      hasImage: true,
      hasError: false,
      models: ['deepseek-chat'],
    })
    expect(total).toBe(1)
  })

  it('生徒名・チャンネル名・モデルが NULL でも落ちない', () => {
    const { items } = mapThreadRows([
      row({ person_name: null, channel_name: null, models: null }),
    ])
    expect(items[0].persons).toBeNull()
    expect(items[0].channelName).toBeNull()
    expect(items[0].models).toEqual([])
  })

  it('total は絞り込み後・ページング前の総件数（先頭行の total_count）', () => {
    const { items, total } = mapThreadRows([
      row({ id: 'a', total_count: 350 }),
      row({ id: 'b', total_count: 350 }),
    ])
    expect(items).toHaveLength(2)
    expect(total).toBe(350)
  })

  it('空配列なら total 0', () => {
    expect(mapThreadRows([])).toEqual({ items: [], total: 0 })
  })
})

describe('conversationRangeFromIso（G-8: JST 暦日基準）', () => {
  it('直近7日は「JST 当日 0:00 の6日前」から（ローリング24hではない）', () => {
    // 2026-07-08 12:00 JST = 2026-07-08 03:00 UTC → JST 7/8 0:00 = 2026-07-07T15:00Z
    const now = new Date('2026-07-08T03:00:00Z')
    expect(conversationRangeFromIso(7, now)).toBe('2026-07-01T15:00:00.000Z')
  })

  it('同じ JST 日なら時刻が違っても境界は同じ（利用状況画面と一致する）', () => {
    const morning = conversationRangeFromIso(30, new Date('2026-07-07T23:00:00Z'))
    const noon = conversationRangeFromIso(30, new Date('2026-07-08T03:00:00Z'))
    expect(morning).toBe(noon)
  })
})

describe('getThreads', () => {
  it('.in() ではなく RPC を1回だけ呼び、フィルタとページングを引数で渡す', async () => {
    const db = createMockDb({ rpc: { admin_thread_list: { data: [row()], error: null } } })
    const res = await getThreads(
      db,
      { personId: 'p1', days: 7, hasError: true, model: 'gpt-4o', limit: 100, offset: 200 },
      new Date('2026-07-08T03:00:00Z'),
    )
    expect(db.__calls.rpc).toHaveLength(1)
    expect(db.__calls.rpc[0][0]).toBe('admin_thread_list')
    expect(db.__calls.rpc[0][1]).toEqual({
      p_person_id: 'p1',
      p_from: '2026-07-01T15:00:00.000Z',
      p_has_image: null,
      p_has_error: true,
      p_model: 'gpt-4o',
      p_limit: 100,
      p_offset: 200,
    })
    expect(res.items[0].messageCount).toBe(4)
    // 旧実装のような thread_ts の .in() 展開が残っていないこと（URL 414 の再発防止）
    expect(db.__calls.from).toHaveLength(0)
  })

  it('フィルタ未指定なら NULL を渡し既定のページサイズを使う', async () => {
    const db = createMockDb({ rpc: { admin_thread_list: { data: [], error: null } } })
    await getThreads(db)
    expect(db.__calls.rpc[0][1]).toMatchObject({
      p_person_id: null,
      p_from: null,
      p_has_image: null,
      p_has_error: null,
      p_model: null,
      p_limit: CONVERSATION_PAGE_SIZE,
      p_offset: 0,
    })
  })

  it('RPC エラーは文脈付きで throw する', async () => {
    const db = createMockDb({
      rpc: { admin_thread_list: { data: null, error: { message: 'boom' } } },
    })
    await expect(getThreads(db)).rejects.toThrow(/getThreads/)
  })
})

describe('getUsedModels', () => {
  it('全行取得ではなく RPC の distinct 結果を返す（1000行上限の回避）', async () => {
    const db = createMockDb({
      rpc: { admin_used_models: { data: ['deepseek-chat', 'gpt-4o'], error: null } },
    })
    expect(await getUsedModels(db)).toEqual(['deepseek-chat', 'gpt-4o'])
    expect(db.__calls.rpc[0][0]).toBe('admin_used_models')
    expect(db.__calls.from).toHaveLength(0)
  })
})

describe('formatMessageTime', () => {
  it('JST の M/D HH:mm で整形する', () => {
    // 2026-07-08 03:05 UTC = 2026-07-08 12:05 JST
    expect(formatMessageTime('2026-07-08T03:05:00Z')).toBe('7/8 12:05')
  })

  it('UTC 深夜は JST で翌日になる', () => {
    // 2026-07-07 16:30 UTC = 2026-07-08 01:30 JST
    expect(formatMessageTime('2026-07-07T16:30:00Z')).toBe('7/8 01:30')
  })
})
