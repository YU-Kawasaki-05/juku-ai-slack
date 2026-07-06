/** @file
 * 機能: Slack message イベントから反応制御・ジョブ登録に必要な事実を抽出する純粋関数
 * 入力: SlackMessageEvent, botUserId
 * 出力: EventFacts
 * 例外: なし
 * 依存: なし
 * セキュリティ: メンション判定は Bot の User ID 完全一致で行う
 * @implements FR-02, FR-03
 */
import { SUPPORTED_IMAGE_MIMETYPES, MAX_IMAGES_PER_MESSAGE } from '@shared/lib/constants'
import type { SlackMessageEvent, SlackFile } from '../types'

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
  /** 対応 MIME の画像（最大 MAX_IMAGES_PER_MESSAGE 枚）。FR-06 BR-06-01/02 */
  images: SlackFile[]
  hasImage: boolean
}

/** 対応 MIME の画像のみを最大枚数まで抽出する（サイズ検証は処理段で行う） */
export function extractSupportedImages(files: SlackFile[] | undefined): SlackFile[] {
  if (!files) return []
  const supported = (SUPPORTED_IMAGE_MIMETYPES as readonly string[])
  return files
    .filter((f) => f.mimetype && supported.includes(f.mimetype))
    .slice(0, MAX_IMAGES_PER_MESSAGE)
}

/**
 * テキストに Bot への明示的メンションが含まれるか。BR-02-03
 * Slack のメンションは `<@U123>` 形式のほか、まれにラベル付き `<@U123|name>` 形式もある。
 */
export function containsMention(text: string | undefined, botUserId: string): boolean {
  if (!text) return false
  return text.includes(`<@${botUserId}>`) || text.includes(`<@${botUserId}|`)
}

/** Bot へのメンション表記 `<@U…>` / `<@U…|name>` を除去して整形する。FR-05 入力 */
export function stripBotMention(text: string | undefined, botUserId: string): string {
  if (!text) return ''
  const escaped = botUserId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text
    .replace(new RegExp(`<@${escaped}(\\|[^>]*)?>`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function deriveEventFacts(event: SlackMessageEvent, botUserId: string): EventFacts {
  // スレッド返信 = thread_ts が存在し、親（ts）自身でない
  const isThreadReply = Boolean(event.thread_ts && event.thread_ts !== event.ts)
  const images = extractSupportedImages(event.files)
  return {
    hasBotId: Boolean(event.bot_id),
    subtype: event.subtype,
    text: event.text,
    hasMention: containsMention(event.text, botUserId),
    isThreadReply,
    threadTs: event.thread_ts ?? event.ts,
    messageTs: event.ts,
    images,
    hasImage: images.length > 0,
  }
}
