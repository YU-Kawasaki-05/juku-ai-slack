/** @file
 * 機能: ダッシュボード用の利用状況サマリー（今日の質問数・今月の推定コスト）
 * 入力: Supabase クライアント（Service Role）、基準時刻（テスト用に注入可）
 * 出力: UsageSummary
 * 例外: DB エラーは上位に伝播
 * 依存: RPC admin_usage_summary（migration 029）
 * 備考: 「今日」「今月」は JST 基準。サーバーの TZ に依存しないよう UTC 境界へ明示変換する。
 *   合計は SQL 側の SUM/COUNT。以前は当月行を全件取得して JS で合算していたため、
 *   PostgREST 既定の 1000 行上限に当たるとエラーにならず黙って過少表示になっていた（E-4）
 * @implements FR-18（SCR-02 サマリーカード）
 */
import type { ServerDb } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'

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
  const { data, error, status, statusText } = await db.rpc('admin_usage_summary', {
    p_day_start: jstDayStartIso(now),
    p_month_start: jstMonthStartIso(now),
  })
  if (error) throw queryError('getUsageSummary', error, { status, statusText })

  const row = data?.[0]
  return {
    todayQuestionCount: Number(row?.today_question_count ?? 0),
    monthCostUsd: Number(row?.month_cost_usd ?? 0),
  }
}
