/** @file
 * 検証: Slack イベントからの事実抽出（メンション判定・スレッド判定）
 * @verifies FR-02, FR-03
 */
import { describe, it, expect } from 'vitest'
import { containsMention, deriveEventFacts, stripBotMention } from './eventFacts'
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
  it('ラベル付きメンション <@U_BOT|name> も検出する', () => {
    expect(containsMention('<@U_BOT|bot> やあ', BOT)).toBe(true)
  })
  it('前方一致の別ID <@U_BOTX> は誤検出しない', () => {
    expect(containsMention('<@U_BOTX> やあ', BOT)).toBe(false)
  })
})

describe('stripBotMention', () => {
  it('メンション記法を除去して整形する', () => {
    expect(stripBotMention('<@U_BOT> 二次方程式は？', 'U_BOT')).toBe('二次方程式は？')
  })
  it('ラベル付き <@U|name> も除去', () => {
    expect(stripBotMention('<@U_BOT|bot> やあ', 'U_BOT')).toBe('やあ')
  })
  it('複数メンションを除去', () => {
    expect(stripBotMention('<@U_BOT> a <@U_BOT> b', 'U_BOT')).toBe('a b')
  })
  it('正規表現特殊文字を含む botUserId でも安全（エスケープ）', () => {
    // 実運用IDでは起きないが、特殊文字が誤解釈されないこと
    expect(stripBotMention('<@U.B+> hi', 'U.B+')).toBe('hi')
    expect(stripBotMention('<@UXBY> hi', 'U.B+')).toBe('<@UXBY> hi')
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

  it('対応画像を最大3枚まで抽出し hasImage を立てる（FR-06 BR-06-01/02）', () => {
    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C1',
      ts: '1',
      text: '<@U_BOT> これ教えて',
      files: [
        { id: 'F1', mimetype: 'image/png', url_private: 'https://x/1' },
        { id: 'F2', mimetype: 'application/pdf', url_private: 'https://x/2' }, // 対応外→除外
        { id: 'F3', mimetype: 'image/jpeg', url_private: 'https://x/3' },
        { id: 'F4', mimetype: 'image/webp', url_private: 'https://x/4' },
        { id: 'F5', mimetype: 'image/png', url_private: 'https://x/5' }, // 4枚目以降→切り捨て
      ],
    }
    const f = deriveEventFacts(event, BOT)
    expect(f.hasImage).toBe(true)
    expect(f.images.map((i) => i.id)).toEqual(['F1', 'F3', 'F4']) // 対応MIMEのみ・最大3枚
  })

  it('画像なしは hasImage=false', () => {
    const event: SlackMessageEvent = { type: 'message', channel: 'C1', ts: '1', text: 'hi' }
    expect(deriveEventFacts(event, BOT).hasImage).toBe(false)
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
