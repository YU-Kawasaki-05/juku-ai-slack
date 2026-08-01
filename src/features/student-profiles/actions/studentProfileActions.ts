/** @file
 * 機能: 生徒プロフィール（AI 参照メモ・試験期間）の UPSERT Server Action
 * 入力: FormData（personId, summary, learningStyle, strengths, weaknesses, instructionNotes,
 *       examMode, examEndDate, examSubjects）
 * 出力: ActionResult
 * 例外: 認証エラー・DB エラーは ActionResult.error に変換（throw しない）
 * 依存: requireStaff, createServerClient, studentProfileSchema
 * 副作用: student_profiles への upsert, 生徒一覧/詳細の revalidate
 * セキュリティ: requireStaff で認証必須（FR-13）。Service Role はサーバー専用。
 *   person_id はフォーム値を zod で検証しサーバーでのみ使用する
 * @implements FR-09, AC-09-01, BR-09-01, DEC-18
 */
'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import type { ActionResult } from '@shared/types/action'
import { studentProfileSchema } from '../schemas/studentProfileSchema'

/** person_id の外部キー違反（存在しない生徒 ID を送られたとき） */
const PG_FOREIGN_KEY_VIOLATION = '23503'

export async function upsertStudentProfileAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  const parsed = studentProfileSchema.safeParse({
    personId: String(formData.get('personId') ?? ''),
    summary: String(formData.get('summary') ?? ''),
    learningStyle: String(formData.get('learningStyle') ?? ''),
    strengths: String(formData.get('strengths') ?? ''),
    weaknesses: String(formData.get('weaknesses') ?? ''),
    instructionNotes: String(formData.get('instructionNotes') ?? ''),
    // checkbox は on / 欠落
    examMode: formData.get('examMode') === 'on',
    examEndDate: String(formData.get('examEndDate') ?? ''),
    examSubjects: String(formData.get('examSubjects') ?? ''),
  })
  if (!parsed.success) {
    return { ok: false, error: '入力内容を確認してください', fieldErrors: flatten(parsed.error) }
  }

  const db = createServerClient()
  // BR-09-01: person_id に対して1レコードのみ（UNIQUE 制約 + onConflict で UPSERT）
  // H-10: .select() を付けて実際に書けたことを確認する（0 行なら成功扱いにしない）
  const { data, error } = await db
    .from('student_profiles')
    .upsert(
      {
        person_id: parsed.data.personId,
        summary: parsed.data.summary,
        learning_style: parsed.data.learningStyle,
        strengths: parsed.data.strengths,
        weaknesses: parsed.data.weaknesses,
        instruction_notes: parsed.data.instructionNotes,
        exam_mode_until: parsed.data.examModeUntil,
        exam_subjects: parsed.data.examSubjects,
      },
      { onConflict: 'person_id' },
    )
    .select('id')
  if (error) {
    if ((error as { code?: string }).code === PG_FOREIGN_KEY_VIOLATION) {
      return { ok: false, error: '対象の生徒が見つかりません' }
    }
    return { ok: false, error: '保存に失敗しました' }
  }
  if (!data || data.length === 0) return { ok: false, error: '保存に失敗しました' }

  // 一覧の「試験期間中」バッジも保存直後に反映させる
  revalidatePath('/admin/persons')
  revalidatePath(`/admin/persons/${parsed.data.personId}`)
  return { ok: true }
}

function flatten(err: import('zod').ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.')
    if (key && !out[key]) out[key] = issue.message
  }
  return out
}
