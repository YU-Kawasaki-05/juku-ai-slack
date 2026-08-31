/** @file
 * 機能: エラーログ更新（対応済みトグル・メモ）の入力バリデーション
 * @implements FR-17, AC-17-02, AC-17-03
 */
import { z } from 'zod'

/** ai_error_logs.severity の全値（migration の CHECK 制約と一致） */
export const ERROR_SEVERITIES = ['error', 'warning', 'info'] as const

export const resolveErrorSchema = z.object({
  id: z.string().uuid(),
  // hidden input からの文字列を boolean へ
  resolved: z.enum(['true', 'false']).transform((v) => v === 'true'),
})

export const errorNotesSchema = z.object({
  id: z.string().uuid(),
  notes: z
    .string()
    .max(2000, 'メモは2000文字以内です')
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .nullable(),
})

export type ResolveErrorInput = z.infer<typeof resolveErrorSchema>
export type ErrorNotesInput = z.infer<typeof errorNotesSchema>
