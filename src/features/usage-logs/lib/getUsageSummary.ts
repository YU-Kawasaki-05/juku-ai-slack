/** @file
 * 機能: ダッシュボード用の利用状況サマリー（今日の質問数・今月の推定コスト）
 * 入力: Supabase クライアント（Service Role）、基準時刻（テスト用に注入可）
 * 出力: UsageSummary
 * 例外: DB エラーは上位に伝播
 * 依存: ai_usage_logs
 * 備考: 「今日」「今月」は JST 基準。サーバーの TZ に依存しないよう UTC 境界へ明示変換する。
 *   コスト合計は当月行の JS 集計（50名・月50件規模のため十分。BR: DEC-20 参照）
 * @implements FR-18（SCR-02 サマリーカード）
 */
import type { ServerDb } from '@shared/types/db'

const JST_OFFSET_MS = 9 * 3600_000

/** JST での当日 0:00 を UTC ISO で返す */
export function jstDayStartIso(now: Date): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS)
  return new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - JST_OFFSET_MS,
  ).toISOString()
}

/** JST での当月1日 0:00 を UTC ISO で返す */
export function jstMonthStartIso(now: Date): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS)
  return new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - JST_OFFSET_MS,
  ).toISOString()
}

export interface UsageSummary {
  /** 今日（JST）の質問数 */
  todayQuestionCount: number
  /** 今月（JST）の推定コスト合計（USD） */
  monthCostUsd: number
}

export async function getUsageSummary(
  db: ServerDb,
  now: Date = new Date(),
): Promise<UsageSummary> {
  const [todayRes, monthRes] = await Promise.all([
    db
      .from('ai_usage_logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', jstDayStartIso(now)),
    db.from('ai_usage_logs').select('estimated_cost').gte('created_at', jstMonthStartIso(now)),
  ])
  if (todayRes.error) throw todayRes.error
  if (monthRes.error) throw monthRes.error

  const monthCostUsd = (monthRes.data ?? []).reduce((sum, r) => sum + (r.estimated_cost ?? 0), 0)
  return { todayQuestionCount: todayRes.count ?? 0, monthCostUsd }
}
