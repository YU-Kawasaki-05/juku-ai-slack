/** @file
 * 機能: Slack message イベントから反応制御・ジョブ登録に必要な事実を抽出する純粋関数
 * 入力: SlackMessageEvent, botUserId
 * 出力: EventFacts
 * 例外: なし
 * 依存: なし
 * セキュリティ: メンション判定は Bot の User ID 完全一致で行う
 * @implements FR-02, FR-03
 */
import type { SlackMessageEvent } from '../types'

export interface EventFacts {
  hasBotId: boolean
  subtype: string | undefined
  text: string | undefined
  hasMention: boolean
  isThreadReply: boolean
  /** セッションの一意キー（thread_ts があればそれ、なければ ts 自身） */
  threadTs: string
  /** 受信メッセージ自身の ts */
  messageTs: string
}

/**
 * テキストに Bot への明示的メンションが含まれるか。BR-02-03
 * Slack のメンションは `<@U123>` 形式のほか、まれにラベル付き `<@U123|name>` 形式もある。
 */
export function containsMention(text: string | undefined, botUserId: string): boolean {
  if (!text) return false
  return text.includes(`<@${botUserId}>`) || text.includes(`<@${botUserId}|`)
}

export function deriveEventFacts(event: SlackMessageEvent, botUserId: string): EventFacts {
  // スレッド返信 = thread_ts が存在し、親（ts）自身でない
  const isThreadReply = Boolean(event.thread_ts && event.thread_ts !== event.ts)
  return {
    hasBotId: Boolean(event.bot_id),
    subtype: event.subtype,
    text: event.text,
    hasMention: containsMention(event.text, botUserId),
    isThreadReply,
    threadTs: event.thread_ts ?? event.ts,
    messageTs: event.ts,
  }
}
