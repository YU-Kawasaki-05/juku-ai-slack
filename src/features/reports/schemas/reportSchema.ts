/** @file
 * 機能: レポート（reports）の入力バリデーション
 * 備考: status は UI から draft/approved のみ設定可。ai_draft は AI 生成（DEC-16）、
 *   sent は Slack 送信処理が設定するため、フォーム入力としては受け付けない
 * @implements FR-16, AC-16-01
 */
import { z } from 'zod'

/** reports.status の全値（migration 003 の CHECK 制約と一致） */
export const REPORT_STATUSES = ['ai_draft', 'draft', 'approved', 'sent'] as const

// input[type=month] の値（YYYY-MM）→ DATE カラム用に月初日へ正規化
const reportMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, '対象月を選択してください')
  .transform((v) => `${v}-01`)

const bodyMarkdown = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v : null))
  .nullable()

export const reportCreateSchema = z.object({
  personId: z.string().uuid('生徒を選択してください'),
  title: z.string().trim().min(1, 'タイトルは必須です').max(200, 'タイトルは200文字以内です'),
  reportMonth,
  bodyMarkdown,
  isAiReference: z.boolean(),
  status: z.enum(['draft', 'approved']),
})

// 生徒・対象月は編集不可（UNIQUE(person_id, report_month) の付け替えは作り直しで対応）
export const reportUpdateSchema = reportCreateSchema
  .omit({ personId: true, reportMonth: true })
  .extend({ id: z.string().uuid() })

export type ReportCreateInput = z.infer<typeof reportCreateSchema>
export type ReportUpdateInput = z.infer<typeof reportUpdateSchema>
