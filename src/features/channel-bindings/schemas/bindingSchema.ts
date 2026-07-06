/** @file
 * 機能: チャンネル紐付けの入力バリデーション
 * @implements FR-15, AC-15-01
 */
import { z } from 'zod'

export const bindingCreateSchema = z.object({
  slackTeamId: z.string().trim().min(1, 'ワークスペースIDは必須です'),
  slackChannelId: z.string().trim().min(1, 'チャンネルIDは必須です'),
  slackChannelName: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .nullable(),
  personId: z.string().uuid('生徒を選択してください'),
  status: z.enum(['active', 'inactive']).default('active'),
})

export const bindingUpdateSchema = z.object({
  id: z.string().uuid(),
  slackChannelName: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .nullable(),
  status: z.enum(['active', 'inactive']),
})

export type BindingCreateInput = z.infer<typeof bindingCreateSchema>
export type BindingUpdateInput = z.infer<typeof bindingUpdateSchema>
