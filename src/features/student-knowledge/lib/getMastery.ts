/** @file
 * 機能: 生徒×トピックの P(mastery) を取得する（未取得はデフォルト）
 * 入力: Supabase クライアント, personId, topic（省略可）
 * 出力: P(mastery)（0〜1）
 * 例外: DB エラーは上位に伝播
 * 依存: student_knowledge_states テーブル
 * 副作用: なし（読み取りのみ）
 * セキュリティ: person_id で必ずフィルタ（BR-05-11）
 * @implements FR-23, FR-05, BR-05-05
 *
 * 注: Sprint 2 時点ではトピック検出（Evaluator, Sprint 3）が未実装のため、
 *     topic 未指定なら常にデフォルト（P_MASTERY_DEFAULT=0.2）を返す。
 */
import type { ServerDb } from '@shared/types/db'
import { P_MASTERY_DEFAULT } from '@shared/lib/constants'
import { decayedMastery } from './knowledgeSummary'

export async function getMastery(
  db: ServerDb,
  personId: string,
  topic?: string | null,
  now: Date = new Date(),
): Promise<number> {
  if (!topic) return P_MASTERY_DEFAULT

  const { data, error } = await db
    .from('student_knowledge_states')
    .select('p_mastery, last_seen_at')
    .eq('person_id', personId)
    .eq('topic', topic)
    .maybeSingle()

  if (error) throw error
  if (!data) return P_MASTERY_DEFAULT
  // BR-23-05: 読取時に忘却減衰を適用
  return decayedMastery(data.p_mastery, data.last_seen_at, now)
}
