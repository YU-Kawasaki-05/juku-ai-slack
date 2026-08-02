/** @file
 * 機能: 管理画面（SCR-03/04）向けの student_profiles 読み取り
 * 入力: Supabase クライアント（Service Role, サーバー専用）, personId / now
 * 出力: 生の profile 行 / 試験期間中の person_id 集合
 * 例外: DB エラーは上位に伝播
 * 依存: student_profiles テーブル
 * 副作用: なし
 * 備考: 回答生成用の getStudentProfile は結合済みテキストを返すため、編集フォームには使えない。
 *   フォームは列そのものを扱う必要があるのでここで生の行を返す
 * セキュリティ: スタッフのみ（呼び出し元ページが認証済み）
 * @implements FR-09, AC-09-01, DEC-18
 */
import type { ServerDb, Tables } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'

export async function getStudentProfileRow(
  db: ServerDb,
  personId: string,
): Promise<Tables<'student_profiles'> | null> {
  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .eq('person_id', personId)
    .maybeSingle()
  if (error) throw queryError('getStudentProfileRow', error)
  return data
}

/** 試験期間中の生徒 ID（SCR-03 のバッジ用）。一覧の件数ぶんクエリを撃たないよう一括で引く */
export async function getExamModePersonIds(
  db: ServerDb,
  now: Date = new Date(),
): Promise<Set<string>> {
  const { data, error } = await db
    .from('student_profiles')
    .select('person_id')
    .gt('exam_mode_until', now.toISOString())
  if (error) throw queryError('getExamModePersonIds', error)
  return new Set((data ?? []).map((r) => r.person_id))
}
