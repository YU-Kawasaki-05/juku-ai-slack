/** @file
 * 検証: 会話ログの純関数（メッセージ件数集計・時刻整形）
 * @verifies FR-19
 */
import { describe, it, expect } from 'vitest'
import { countMessagesByThread, formatMessageTime } from './getConversations'

describe('countMessagesByThread', () => {
  it('チャンネル×スレッド単位で件数を数える', () => {
    const m = countMessagesByThread([
      { slack_channel_id: 'C1', thread_ts: '100.1' },
      { slack_channel_id: 'C1', thread_ts: '100.1' },
      { slack_channel_id: 'C1', thread_ts: '200.2' },
      { slack_channel_id: 'C2', thread_ts: '100.1' },
    ])
    expect(m.get('C1:100.1')).toBe(2)
    expect(m.get('C1:200.2')).toBe(1)
    // 同じ thread_ts でもチャンネルが違えば別スレッド
    expect(m.get('C2:100.1')).toBe(1)
  })

  it('空配列は空マップ', () => {
    expect(countMessagesByThread([]).size).toBe(0)
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
