/** @file
 * 機能: Slack Events API ペイロードの Zod スキーマと反応制御の判定型
 * 入力: Slack Webhook の JSON body
 * 出力: 検証済み型・ReactionDecision
 * @implements FR-01, FR-02
 */
import { z } from 'zod'

/** url_verification（エンドポイント検証）リクエスト。AC-01-01 */
export const slackUrlVerificationSchema = z.object({
  type: z.literal('url_verification'),
  challenge: z.string(),
})

/** message イベント本体。未知フィールドは許容（passthrough） */
export const slackMessageEventSchema = z
  .object({
    type: z.string(),
    channel: z.string(),
    ts: z.string(),
    user: z.string().optional(),
    text: z.string().optional(),
    thread_ts: z.string().optional(),
    bot_id: z.string().optional(),
    subtype: z.string().optional(),
  })
  .passthrough()

/** event_callback ラッパー。event は種別を問わず受け、message は別途 narrow する */
export const slackEventCallbackSchema = z.object({
  type: z.literal('event_callback'),
  event_id: z.string(),
  team_id: z.string(),
  event: z.object({ type: z.string() }).passthrough(),
})

/** Slack Webhook body の判別ユニオン */
export const slackEnvelopeSchema = z.discriminatedUnion('type', [
  slackUrlVerificationSchema,
  slackEventCallbackSchema,
])

export type SlackMessageEvent = z.infer<typeof slackMessageEventSchema>
export type SlackEventCallback = z.infer<typeof slackEventCallbackSchema>
export type SlackEnvelope = z.infer<typeof slackEnvelopeSchema>

/** チャンネル紐付けの状態 */
export type BindingStatus = 'active' | 'inactive' | 'none'

/** 反応制御の判定に必要な入力（DB 参照結果を注入する純粋関数用）。FR-02 */
export interface ShouldReactInput {
  /** Bot 自身のメッセージか（bot_id の有無）。BR-02-01 */
  hasBotId: boolean
  /** message の subtype（message_changed 等）。BR-02-02 */
  subtype: string | null | undefined
  /** メッセージ本文。BR-02-06 */
  text: string | null | undefined
  /** Bot への明示的メンションを含むか。BR-02-03 */
  hasMention: boolean
  /** スレッド内返信か（thread_ts が存在し、かつ親と異なる）。BR-02-04 */
  isThreadReply: boolean
  /** チャンネル紐付けの状態。BR-02-05 / BR-07-03 */
  bindingStatus: BindingStatus
  /** 当該スレッドが slack_thread_sessions に登録済みか。BR-02-04 */
  sessionExists: boolean
}

/** 反応制御の判定結果 */
export type ReactionDecision =
  | { action: 'ignore'; reason: string }
  | { action: 'process' }
  | { action: 'channel_not_bound' }
