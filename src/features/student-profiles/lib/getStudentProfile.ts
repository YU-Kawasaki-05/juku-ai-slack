/** @file
 * 機能: 生徒プロフィール要約と試験前モードの取得
 * 入力: Supabase クライアント, personId, now（判定基準時刻）
 * 出力: { profileText, examMode }
 * 例外: DB エラーは上位に伝播
 * 依存: student_profiles テーブル, persons テーブル（grade 列のみ）
 * 副作用: なし（読み取りのみ）
 * セキュリティ: person_id で必ずフィルタ（他生徒の情報を混入させない。BR-05-11）。
 *   LLM に送るのは学年までで、氏名（persons.name）と生徒 ID は送らない（下のコメント参照）
 * @implements FR-09, FR-05, AC-05-05, AC-05-09
 */
import type { ServerDb } from '@shared/types/db'
import { isExamModeActive } from './examPeriod'

export interface StudentProfileResult {
  /** プロンプトに載せる生徒メモ（学年 + 非nullフィールドを結合）。無ければ null */
  profileText: string | null
  /** exam_mode_until が未来なら true。BR-05-08（→ selectMode が direct を返す） */
  examMode: boolean
}

export async function getStudentProfile(
  db: ServerDb,
  personId: string,
  now: Date = new Date(),
): Promise<StudentProfileResult> {
  // 学年は persons 側の列なので別クエリで引く。student_profiles との join にしないのは
  // プロフィール未登録（student_profiles に行が無い）生徒でも学年だけは載せたいため。
  // Promise.all で並列に投げるので追加のレイテンシは実質ない。
  // persons からは grade だけを select する（* や name を取らない）ことで、
  // 氏名がこの関数のスコープに入ってくる余地自体を無くしている
  const [profileRes, personRes] = await Promise.all([
    db
      .from('student_profiles')
      .select(
        'summary, learning_style, strengths, weaknesses, instruction_notes, exam_mode_until, exam_subjects',
      )
      .eq('person_id', personId)
      .maybeSingle(),
    db.from('persons').select('grade').eq('id', personId).maybeSingle(),
  ])

  if (profileRes.error) throw profileRes.error
  if (personRes.error) throw personRes.error

  const profile = profileRes.data
  const examMode = isExamModeActive(profile?.exam_mode_until, now)

  const parts: string[] = []

  // 学年は回答の粒度に直結する（中1と高3で説明の深さ・語彙を変える必要がある）ので先頭に置く。
  // 逆に氏名（persons.name）と生徒 ID（UUID）は載せない:
  //   - 氏名は回答品質に寄与せず、外部 LLM に渡す必要がない個人情報
  //   - UUID は LLM にとって意味を持たない文字列でトークンを消費するだけ。
  //     生徒の識別・紐付けは Slack / DB 側で完結しており、プロンプトに入れる意味がない
  // 未設定（null / 空白のみ）なら「未設定」とは書かず、行そのものを出さない
  const grade = personRes.data?.grade?.trim()
  if (grade) parts.push(`学年: ${grade}`)

  if (profile) {
    if (profile.summary) parts.push(`要約: ${profile.summary}`)
    if (profile.learning_style) parts.push(`学習スタイル: ${profile.learning_style}`)
    if (profile.strengths) parts.push(`得意: ${profile.strengths}`)
    if (profile.weaknesses) parts.push(`苦手: ${profile.weaknesses}`)
    if (profile.instruction_notes) parts.push(`指導メモ: ${profile.instruction_notes}`)
    // DEC-18: 試験科目は期間中だけ意味を持つ。期間外に載せると「今この科目の試験がある」と誤解させる
    if (examMode && profile.exam_subjects && profile.exam_subjects.length > 0) {
      parts.push(`直近の試験科目: ${profile.exam_subjects.join('、')}`)
    }
  }

  return {
    profileText: parts.length > 0 ? parts.join('\n') : null,
    examMode,
  }
}
