/** @file
 * 機能: Evaluation 結果を student_knowledge_states に反映する（BKT 更新 + UPSERT）
 * 入力: Supabase クライアント, personId, Evaluation, now
 * 出力: ApplyResult（更新有無と理由）
 * 例外: DB エラーは上位に伝播
 * 依存: student_knowledge_states テーブル, bkt
 * 副作用: 行の UPSERT（skip/低確信度/unknown は書き込まない）
 * セキュリティ: person_id で厳密にフィルタ（BR-23-04, BR-05-11）
 * @implements FR-23, AC-23-01, AC-23-02, AC-23-03, AC-23-07, BR-23-01〜05
 */
import type { ServerDb, Tables, TablesInsert } from '@shared/types/db'
import {
  P_MASTERY_DEFAULT,
  EVAL_MIN_CONFIDENCE,
  FORGETTING_DECAY_MIN_DAYS,
  UNKNOWN_TOPIC,
} from '@shared/lib/constants'
import { updateBKT, applyForgettingDecay } from './bkt'
import type { Evaluation } from './evaluationSchema'

export type ApplySkipReason = 'skip' | 'unknown_topic' | 'low_confidence'

export interface ApplyResult {
  updated: boolean
  reason?: ApplySkipReason
  newPMastery?: number
}

const MS_PER_DAY = 1000 * 60 * 60 * 24

export async function applyEvaluation(
  db: ServerDb,
  personId: string,
  evaluation: Evaluation,
  now: Date = new Date(),
): Promise<ApplyResult> {
  // BR-23-02: skip は BKT を完全据え置き（attempt_count / last_seen_at も更新しない）
  if (evaluation.signal === 'skip') return { updated: false, reason: 'skip' }
  // トピック特定不能はスキップ
  if (!evaluation.topic_id || evaluation.topic_id === UNKNOWN_TOPIC) {
    return { updated: false, reason: 'unknown_topic' }
  }
  // BR-23-03 / AC-23-07: 低確信度は書き込まない（呼び出し側が LOW_CONFIDENCE_SKIP を記録）
  if (evaluation.confidence < EVAL_MIN_CONFIDENCE) {
    return { updated: false, reason: 'low_confidence' }
  }

  const { data: existing, error: readError } = await db
    .from('student_knowledge_states')
    .select('*')
    .eq('person_id', personId)
    .eq('topic', evaluation.topic_id)
    .maybeSingle()
  if (readError) throw readError

  const current = existing as Tables<'student_knowledge_states'> | null

  // 現在値（forgetting decay を BR-23-05 の閾値超過時のみ適用）
  let basP = current?.p_mastery ?? P_MASTERY_DEFAULT
  if (current?.last_seen_at) {
    const days = (now.getTime() - new Date(current.last_seen_at).getTime()) / MS_PER_DAY
    if (days >= FORGETTING_DECAY_MIN_DAYS) {
      basP = applyForgettingDecay(basP, days)
    }
  }

  // BR-23-01: partial は is_correct=false（保守的）
  const isCorrect = evaluation.signal === 'correct'
  const newP = updateBKT(basP, isCorrect)
  const consecutiveCorrect = isCorrect ? (current?.consecutive_correct ?? 0) + 1 : 0
  const attemptCount = (current?.attempt_count ?? 0) + 1

  const row: TablesInsert<'student_knowledge_states'> = {
    person_id: personId,
    topic: evaluation.topic_id,
    subject: evaluation.subject,
    p_mastery: newP,
    attempt_count: attemptCount,
    consecutive_correct: consecutiveCorrect,
    last_seen_at: now.toISOString(),
  }

  const { error: upsertError } = await db
    .from('student_knowledge_states')
    .upsert(row, { onConflict: 'person_id,topic' })
  if (upsertError) throw upsertError

  return { updated: true, newPMastery: newP }
}
