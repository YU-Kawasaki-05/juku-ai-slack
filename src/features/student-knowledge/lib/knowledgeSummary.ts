/** @file
 * 機能: 生徒の知識状態サマリーを生成する（プロンプト注入用）。読取時に忘却減衰を適用（BR-23-05）
 * 入力: Supabase クライアント, personId, now
 * 出力: サマリー文字列 or null（レコードなし）
 * 例外: DB エラーは上位に伝播
 * 依存: student_knowledge_states テーブル, bkt
 * 副作用: なし（読み取りのみ）
 * セキュリティ: person_id で厳密フィルタ（BR-05-11）
 * @implements FR-23, AC-23-05, BR-23-05
 */
import type { ServerDb, Tables } from '@shared/types/db'
import {
  BKT_MASTERED_THRESHOLD,
  P_MASTERY_DIRECT_MAX,
  FORGETTING_DECAY_MIN_DAYS,
} from '@shared/lib/constants'
import { applyForgettingDecay } from './bkt'

const MS_PER_DAY = 1000 * 60 * 60 * 24

function label(p: number): string {
  if (p >= BKT_MASTERED_THRESHOLD) return '習得済'
  if (p < P_MASTERY_DIRECT_MAX) return '苦手'
  return '習得中'
}

/** 読取時に last_seen_at から 14 日以上経過していれば忘却減衰を適用する（BR-23-05） */
export function decayedMastery(
  pMastery: number,
  lastSeenAt: string | null,
  now: Date = new Date(),
): number {
  if (!lastSeenAt) return pMastery
  const days = (now.getTime() - new Date(lastSeenAt).getTime()) / MS_PER_DAY
  if (days < FORGETTING_DECAY_MIN_DAYS) return pMastery
  return applyForgettingDecay(pMastery, days)
}

/**
 * FR-23 の注入フォーマットで科目別サマリーを返す。例:
 *   数学: 二次方程式(習得中:P=0.45,3回) / 確率(苦手:P=0.18,2回)
 */
export async function getKnowledgeSummary(
  db: ServerDb,
  personId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const { data, error } = await db
    .from('student_knowledge_states')
    .select('topic, subject, p_mastery, attempt_count, last_seen_at')
    .eq('person_id', personId)
  if (error) throw error
  if (!data || data.length === 0) return null

  const rows = data as Pick<
    Tables<'student_knowledge_states'>,
    'topic' | 'subject' | 'p_mastery' | 'attempt_count' | 'last_seen_at'
  >[]

  const bySubject = new Map<string, string[]>()
  for (const r of rows) {
    const p = decayedMastery(r.p_mastery, r.last_seen_at, now)
    const item = `${r.topic}(${label(p)}:P=${p.toFixed(2)},${r.attempt_count}回)`
    const list = bySubject.get(r.subject) ?? []
    list.push(item)
    bySubject.set(r.subject, list)
  }

  const lines = [...bySubject.entries()].map(([subject, items]) => `${subject}: ${items.join(' / ')}`)
  return lines.join('\n')
}
