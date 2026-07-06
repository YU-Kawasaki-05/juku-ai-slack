/** @file
 * 機能: 生徒プロフィール要約と試験前モードの取得
 * 入力: Supabase クライアント, personId, now（判定基準時刻）
 * 出力: { profileText, examMode }
 * 例外: DB エラーは上位に伝播
 * 依存: student_profiles テーブル
 * 副作用: なし（読み取りのみ）
 * セキュリティ: person_id で必ずフィルタ（他生徒の情報を混入させない。BR-05-11）
 * @implements FR-09, FR-05, AC-05-05, AC-05-09
 */
import type { ServerDb } from '@shared/types/db'

export interface StudentProfileResult {
  /** プロンプトに載せる生徒メモ（非nullフィールドを結合）。無ければ null */
  profileText: string | null
  /** exam_mode_until が未来なら true。BR-05-08 */
  examMode: boolean
}

export async function getStudentProfile(
  db: ServerDb,
  personId: string,
  now: Date = new Date(),
): Promise<StudentProfileResult> {
  const { data, error } = await db
    .from('student_profiles')
    .select('summary, learning_style, strengths, weaknesses, instruction_notes, exam_mode_until')
    .eq('person_id', personId)
    .maybeSingle()

  if (error) throw error
  if (!data) return { profileText: null, examMode: false }

  const parts: string[] = []
  if (data.summary) parts.push(`要約: ${data.summary}`)
  if (data.learning_style) parts.push(`学習スタイル: ${data.learning_style}`)
  if (data.strengths) parts.push(`得意: ${data.strengths}`)
  if (data.weaknesses) parts.push(`苦手: ${data.weaknesses}`)
  if (data.instruction_notes) parts.push(`指導メモ: ${data.instruction_notes}`)

  const examMode = data.exam_mode_until ? new Date(data.exam_mode_until) > now : false

  return {
    profileText: parts.length > 0 ? parts.join('\n') : null,
    examMode,
  }
}
