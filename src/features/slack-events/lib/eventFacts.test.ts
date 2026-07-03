/** @file
 * 検証: Slack イベントからの事実抽出（メンション判定・スレッド判定）
 * @verifies FR-02, FR-03
 */
import { describe, it, expect } from 'vitest'
import { containsMention, deriveEventFacts } from './eventFacts'
import type { SlackMessageEvent } from '../types'

const BOT = 'U_BOT'

describe('containsMention', () => {
  it('Bot メンションを含めば true', () => {
    expect(containsMention('<@U_BOT> 質問です', BOT)).toBe(true)
  })
  it('別ユーザーへのメンションは false', () => {
    expect(containsMention('<@U_OTHER> やあ', BOT)).toBe(false)
  })
  it('テキストなしは false', () => {
    expect(containsMention(undefined, BOT)).toBe(false)
  })
})

describe('deriveEventFacts', () => {
  it('チャンネル直下（thread_ts なし）は isThreadReply=false、threadTs=ts', () => {
    const event: SlackMessageEvent = { type: 'message', channel: 'C1', ts: '100.1', text: 'hi' }
    const f = deriveEventFacts(event, BOT)
    expect(f.isThreadReply).toBe(false)
    expect(f.threadTs).toBe('100.1')
    expect(f.messageTs).toBe('100.1')
  })

  it('スレッド返信（thread_ts != ts）は isThreadReply=true、threadTs=thread_ts', () => {
    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C1',
      ts: '200.2',
      thread_ts: '100.1',
      text: 'follow up',
    }
    const f = deriveEventFacts(event, BOT)
    expect(f.isThreadReply).toBe(true)
    expect(f.threadTs).toBe('100.1')
    expect(f.messageTs).toBe('200.2')
  })

  it('親メッセージ（thread_ts === ts）は isThreadReply=false', () => {
    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C1',
      ts: '100.1',
      thread_ts: '100.1',
      text: 'root',
    }
    expect(deriveEventFacts(event, BOT).isThreadReply).toBe(false)
  })

  it('bot_id / subtype / mention を正しく反映', () => {
    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C1',
      ts: '1',
      bot_id: 'B1',
      subtype: 'bot_message',
      text: '<@U_BOT> hi',
    }
    const f = deriveEventFacts(event, BOT)
    expect(f.hasBotId).toBe(true)
    expect(f.subtype).toBe('bot_message')
    expect(f.hasMention).toBe(true)
  })
})
