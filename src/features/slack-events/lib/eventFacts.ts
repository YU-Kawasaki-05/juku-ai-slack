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
  /** 枚数上限で切り捨てた対応画像の枚数。無通知の破棄を避けるため回答に添える案内に使う */
  droppedImageCount: number
}

/**
 * 対応 MIME の画像を最大枚数まで選び、上限超過で捨てた枚数も返す。
 * 捨てた枚数を返すのは、4枚目以降が生徒にも運用者にも無通知で消えるのを防ぐため。
 */
export function selectSupportedImages(files: SlackFile[] | undefined): {
  images: SlackFile[]
  droppedCount: number
} {
  const supported = (SUPPORTED_IMAGE_MIMETYPES as readonly string[])
  const all = (files ?? []).filter((f) => f.mimetype && supported.includes(f.mimetype))
  return {
    images: all.slice(0, MAX_IMAGES_PER_MESSAGE),
    droppedCount: Math.max(0, all.length - MAX_IMAGES_PER_MESSAGE),
  }
}

/** 対応 MIME の画像のみを最大枚数まで抽出する（サイズ検証は処理段で行う） */
export function extractSupportedImages(files: SlackFile[] | undefined): SlackFile[] {
  return selectSupportedImages(files).images
}

/**
 * テキストに Bot への明示的メンションが含まれるか。BR-02-03
 * Slack のメンションは `<@U123>` 形式のほか、まれにラベル付き `<@U123|name>` 形式もある。
 */
export function containsMention(text: string | undefined, botUserId: string): boolean {
  if (!text) return false
  return text.includes(`<@${botUserId}>`) || text.includes(`<@${botUserId}|`)
}

/**
 * Slack のリンク記法を人間（および LLM）が読める形に開く。G-2
 *
 * Slack は `<...>` を制御シーケンスとして送ってくる。素通しすると LLM にも管理画面にも
 * `<#C123|math>` のような内部表現が出てしまうため、意味を保った平文に落とす。
 */
function humanizeSlackMarkup(text: string): string {
  return (
    text
      // 他ユーザーへのメンション。ID をそのまま LLM に渡しても意味がないので表示名 or 総称にする
      .replace(/<@([^>|\s]+)(?:\|([^>]*))?>/g, (_m, _id: string, label?: string) =>
        label ? `@${label}` : '@ユーザー',
      )
      // チャンネル参照
      .replace(/<#([^>|\s]+)(?:\|([^>]*))?>/g, (_m, id: string, label?: string) =>
        label ? `#${label}` : `#${id}`,
      )
      // 特殊メンション（@channel / @here / @everyone）
      .replace(/<!(channel|here|everyone)(?:\|[^>]*)?>/g, '@$1')
      // mailto / tel はラベル（=アドレス自身のことが多い）だけで十分
      .replace(/<(?:mailto|tel):[^|>]+\|([^>]*)>/g, '$1')
      .replace(/<(?:mailto|tel):([^|>]+)>/g, '$1')
      // URL: ラベル付きは「ラベル (URL)」、素の URL はそのまま
      .replace(/<((?:https?|ftp):[^|>]+)\|([^>]*)>/g, '$2 ($1)')
      .replace(/<((?:https?|ftp):[^|>]+)>/g, '$1')
  )
}

/**
 * Slack が送ってくる HTML エンティティを復号する。G-2
 *
 * Slack は本文中の `&`, `<`, `>` を必ずエンコードして送るため、復号しないと
 * `x &lt; 5` のような不等号（数学チューターの中核語彙）がそのまま LLM と DB に入る。
 * `&amp;` を最後に戻すこと（先に戻すと `&amp;lt;` が `<` に化ける）。
 */
function decodeSlackEntities(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/**
 * Bot へのメンション表記 `<@U…>` / `<@U…|name>` を除去して整形する。FR-05 入力
 *
 * G-1: 改行は保持する。`\s+` で潰すと連立方程式・箇条書き・コードブロックが
 *      1 行に平坦化され、LLM・DB・管理画面のすべてに伝播する。
 * G-2: Slack のリンク記法を平文化し、最後に HTML エンティティを復号する。
 *      復号を最後に置くのは、生徒が入力した `&lt;@U123&gt;`（文字としての `<@U123>`）を
 *      メンションとして誤解釈しないため。
 */
export function stripBotMention(text: string | undefined, botUserId: string): string {
  if (!text) return ''
  const escaped = botUserId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withoutBotMention = text.replace(new RegExp(`<@${escaped}(\\|[^>]*)?>`, 'g'), ' ')
  return decodeSlackEntities(
    humanizeSlackMarkup(withoutBotMention)
      // 行内の空白のみ圧縮（\r\n は温存）
      .replace(/[^\S\r\n]+/g, ' ')
      // 行末・行頭の余分な空白を落としてから、空行の連続を最大 1 行に丸める
      .replace(/[^\S\r\n]*\r?\n[^\S\r\n]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  )
}

export function deriveEventFacts(event: SlackMessageEvent, botUserId: string): EventFacts {
  // スレッド返信 = thread_ts が存在し、親（ts）自身でない
  const isThreadReply = Boolean(event.thread_ts && event.thread_ts !== event.ts)
  const { images, droppedCount } = selectSupportedImages(event.files)
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
    droppedImageCount: droppedCount,
  }
}
