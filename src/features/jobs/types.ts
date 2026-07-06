/** @file
 * 機能: 非同期ジョブの payload スキーマ
 * 入力: ジョブ登録時の payload
 * 出力: 検証済み ProcessSlackMessagePayload
 * セキュリティ: raw body は含めない（BR-04-05）。person_id は channel_id 解決済みの値のみ
 * @implements FR-04
 */
import { z } from 'zod'

/**
 * process_slack_message ジョブの payload。
 * BR-04-05: Slack 署名検証後の必要情報のみ。raw body は含めない。
 */
export const processSlackMessagePayloadSchema = z.object({
  teamId: z.string(),
  channelId: z.string(),
  /** 受信メッセージ自体の ts（リアクション対象） */
  messageTs: z.string(),
  /** スレッドの親 ts（スレッド返信なら thread_ts、直下なら message_ts） */
  threadTs: z.string(),
  userId: z.string().nullable(),
  text: z.string().nullable(),
  /** channel_id から解決済みの person_id。クライアント値を信用しない（FR-07） */
  personId: z.string().uuid(),
  reportId: z.string().uuid().nullable(),
  /** 重複判定・トレース用 */
  eventId: z.string(),
  /** 添付画像（対応 MIME・最大3枚）。FR-06。raw body は含めない */
  files: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().nullable(),
        mimetype: z.string(),
        size: z.number().nullable(),
        urlPrivate: z.string(),
      }),
    )
    .optional(),
})

export type ProcessSlackMessagePayload = z.infer<typeof processSlackMessagePayloadSchema>
