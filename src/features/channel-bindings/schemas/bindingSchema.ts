/** @file
 * 機能: チャンネル紐付けの入力バリデーション
 * セキュリティ: channel_id は「誰の質問か」を決める信頼の基点（BR-07-01）。
 *   長さ・形式を検証して DB カラム長超過や不正 ID の混入を防ぐ（H-7）
 * @implements FR-15, AC-15-01
 */
import { z } from 'zod'

/** Slack チャンネル ID。public=C / private group=G / DM=D 始まりの英数字（006 の VARCHAR(50)） */
const SLACK_CHANNEL_ID_RE = /^[CGD][A-Z0-9]+$/
/** Slack ワークスペース（team）ID。T 始まりの英数字（006 の VARCHAR(50)） */
const SLACK_TEAM_ID_RE = /^T[A-Z0-9]+$/

const MAX_SLACK_ID_LEN = 50
const MAX_CHANNEL_NAME_LEN = 200

const slackTeamId = z
  .string()
  .trim()
  .min(1, 'ワークスペースIDは必須です')
  .max(MAX_SLACK_ID_LEN, `ワークスペースIDは${MAX_SLACK_ID_LEN}文字以内で入力してください`)
  .regex(SLACK_TEAM_ID_RE, 'ワークスペースIDの形式が正しくありません（例: T01ABCDEFGH）')

const slackChannelId = z
  .string()
  .trim()
  .min(1, 'チャンネルIDは必須です')
  .max(MAX_SLACK_ID_LEN, `チャンネルIDは${MAX_SLACK_ID_LEN}文字以内で入力してください`)
  .regex(SLACK_CHANNEL_ID_RE, 'チャンネルIDの形式が正しくありません（例: C01ABCDEFGH）')

// 表示用の任意項目。空文字は null に正規化してから長さを検査する
const slackChannelName = z
  .string()
  .max(MAX_CHANNEL_NAME_LEN, `チャンネル名は${MAX_CHANNEL_NAME_LEN}文字以内で入力してください`)
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .nullable()

/** Select の「指定しない」。未選択だと FormData にキーが現れないためフォーム側で明示値を送る */
export const NO_DEFAULT_REPORT = 'none'

// 任意項目。'none' / 空文字は null に正規化し、それ以外は UUID を要求する
const defaultReportId = z
  .string()
  .optional()
  .transform((v) => (!v || v === NO_DEFAULT_REPORT ? null : v))
  .pipe(z.string().uuid('既定レポートの選択が不正です').nullable())

export const bindingCreateSchema = z.object({
  slackTeamId,
  slackChannelId,
  slackChannelName,
  personId: z.string().uuid('生徒を選択してください'),
  defaultReportId,
  status: z.enum(['active', 'inactive']).default('active'),
})

export const bindingUpdateSchema = z.object({
  id: z.string().uuid(),
  slackChannelName,
  status: z.enum(['active', 'inactive']),
})

export type BindingCreateInput = z.infer<typeof bindingCreateSchema>
export type BindingUpdateInput = z.infer<typeof bindingUpdateSchema>
