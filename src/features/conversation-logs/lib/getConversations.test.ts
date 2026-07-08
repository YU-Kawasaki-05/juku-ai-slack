/** @file
 * 検証: 会話ログの純関数（スレッドメタ集計・時刻整形）
 * @verifies FR-19
 */
import { describe, it, expect } from 'vitest'
import { buildThreadMeta, formatMessageTime } from './getConversations'

describe('buildThreadMeta', () => {
  it('チャンネル×スレッド単位で件数・画像有無・モデル・エラー有無を集計する', () => {
    const meta = buildThreadMeta(
      [
        { slack_channel_id: 'C1', thread_ts: '100.1', has_attachments: false },
        { slack_channel_id: 'C1', thread_ts: '100.1', has_attachments: true },
        { slack_channel_id: 'C1', thread_ts: '200.2', has_attachments: false },
      ],
      [
        { slack_channel_id: 'C1', thread_ts: '100.1', model: 'deepseek-chat' },
        { slack_channel_id: 'C1', thread_ts: '100.1', model: 'gpt-4o' },
        { slack_channel_id: 'C1', thread_ts: '100.1', model: 'deepseek-chat' },
      ],
      [{ slack_channel_id: 'C1', thread_ts: '200.2' }],
    )
    expect(meta.get('C1:100.1')).toEqual({
      count: 2,
      hasImage: true,
      hasError: false,
      models: ['deepseek-chat', 'gpt-4o'],
    })
    expect(meta.get('C1:200.2')).toEqual({
      count: 1,
      hasImage: false,
      hasError: true,
      models: [],
    })
  })

  it('同じ thread_ts でもチャンネルが違えば別スレッド', () => {
    const meta = buildThreadMeta(
      [
        { slack_channel_id: 'C1', thread_ts: '100.1', has_attachments: false },
        { slack_channel_id: 'C2', thread_ts: '100.1', has_attachments: false },
      ],
      [],
      [],
    )
    expect(meta.get('C1:100.1')?.count).toBe(1)
    expect(meta.get('C2:100.1')?.count).toBe(1)
  })

  it('channel_id / thread_ts が欠けた行は無視する', () => {
    const meta = buildThreadMeta(
      [{ slack_channel_id: null, thread_ts: '100.1', has_attachments: true }],
      [{ slack_channel_id: 'C1', thread_ts: null, model: 'x' }],
      [{ slack_channel_id: null, thread_ts: null }],
    )
    expect(meta.size).toBe(0)
  })

  it('空入力は空マップ', () => {
    expect(buildThreadMeta([], [], []).size).toBe(0)
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
