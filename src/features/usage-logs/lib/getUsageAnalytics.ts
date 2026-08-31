/** @file
 * 機能: 利用状況ダッシュボード（SCR-10 / FR-18）の集計
 * 入力: Supabase クライアント（Service Role）、期間（日数）、基準時刻（テスト用に注入可）
 * 出力: UsageAnalytics（サマリー / 日別 / モデル別 / 生徒別 / エラーコード別）
 * 例外: DB エラーは queryError で文脈付きに変換して伝播
 * 依存: RPC admin_usage_analytics（migration 029）
 * 備考: SUM/COUNT/GROUP BY は SQL 側。以前は期間内の行を全件取得して JS 集計していたため、
 *   PostgREST 既定の 1000 行上限に当たるとエラーにならず黙って過少表示になっていた（E-4）。
 *   「日」は JST 暦日（SQL 側で AT TIME ZONE 'Asia/Tokyo'）。
 *   0 埋め・並べ替え・上位N件の絞り込みは純関数 buildAnalytics に分離しテスト可能にする
 * @implements FR-18
 */
import type { ServerDb } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'
import { jstDayStartIso } from './getUsageSummary'
import { findUnpricedModels } from './unpricedModels'

const JST_OFFSET_MS = 9 * 3600_000
const DAY_MS = 86_400_000

/** 生徒名が解決できなかった行の表示名 */
export const UNKNOWN_PERSON_LABEL = '（不明）'

/** 期間フィルタの選択肢（日数） */
export const USAGE_RANGES = [7, 30, 90] as const
export type UsageRangeDays = (typeof USAGE_RANGES)[number]

/** admin_usage_analytics（JSONB）の戻り値。snake_case は SQL 側の命名そのまま */
export interface UsageAnalyticsRaw {
  totals: {
    question_count: number
    cost_usd: number
    input_tokens: number
    output_tokens: number
    total_tokens: number
    image_count: number
  }
  daily: { date: string; count: number; cost_usd: number; tokens: number }[]
  by_model: { model: string; count: number; cost_usd: number }[]
  by_person: { person_id: string | null; name: string | null; count: number }[]
  errors_by_code: { code: string; count: number }[]
}

export interface UsageAnalytics {
  rangeDays: number
  totals: {
    questionCount: number
    costUsd: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    imageCount: number
  }
  /** 期間の全日を 0 埋めで含む昇順の日別系列 */
  daily: { date: string; label: string; count: number; costUsd: number; tokens: number }[]
  /** 利用回数の多い順 */
  byModel: { model: string; count: number; costUsd: number }[]
  /** 質問数トップ（最大 10 件、多い順）。同姓同名の合算を避けるためキーは person_id（G-7） */
  byPerson: { personId: string | null; name: string; count: number }[]
  /** 発生数の多い順 */
  errorsByCode: { code: string; count: number }[]
  rateLimitCount: number
  /**
   * 期間内に使われたモデルのうち MODEL_PRICING に単価が無いもの（#7）。
   * 該当があるとコストが実額より小さく出る（cost=0 で記録される）ため、画面で警告する。
   */
  unpricedModels: string[]
}

/** UTC ISO → JST の日付キー（YYYY-MM-DD） */
function jstDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' → 'M/D' */
function monthDayLabel(key: string): string {
  const [, m, d] = key.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 期間内の全日キー（昇順、今日を含め過去 days 日、JST 基準） */
function buildDayKeys(days: number, now: Date): string[] {
  const todayStartMs = new Date(jstDayStartIso(now)).getTime()
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    keys.push(jstDateKey(new Date(todayStartMs - i * DAY_MS).toISOString()))
  }
  return keys
}

/** 集計済みの DB 結果を画面用に整える純関数（DB 非依存・テスト対象） */
export function buildAnalytics(
  raw: UsageAnalyticsRaw,
  days: number,
  now: Date,
): UsageAnalytics {
  const dayKeys = buildDayKeys(days, now)
  const dailyMap = new Map<string, { count: number; costUsd: number; tokens: number }>()
  for (const key of dayKeys) dailyMap.set(key, { count: 0, costUsd: 0, tokens: 0 })
  for (const d of raw.daily ?? []) {
    // 期間外（境界の取りこぼし）は日別に加算しない
    const slot = dailyMap.get(d.date)
    if (!slot) continue
    slot.count += d.count
    slot.costUsd += d.cost_usd
    slot.tokens += d.tokens
  }

  const errorsByCode = [...(raw.errors_by_code ?? [])]
    .map((e) => ({ code: e.code, count: e.count }))
    .sort((a, b) => b.count - a.count)

  const byModel = [...(raw.by_model ?? [])]
    .map((m) => ({ model: m.model, count: m.count, costUsd: m.cost_usd }))
    .sort((a, b) => b.count - a.count)

  return {
    rangeDays: days,
    totals: {
      questionCount: raw.totals?.question_count ?? 0,
      costUsd: raw.totals?.cost_usd ?? 0,
      inputTokens: raw.totals?.input_tokens ?? 0,
      outputTokens: raw.totals?.output_tokens ?? 0,
      totalTokens: raw.totals?.total_tokens ?? 0,
      imageCount: raw.totals?.image_count ?? 0,
    },
    daily: dayKeys.map((date) => ({
      date,
      label: monthDayLabel(date),
      ...dailyMap.get(date)!,
    })),
    byModel,
    byPerson: [...(raw.by_person ?? [])]
      .map((p) => ({
        personId: p.person_id,
        name: p.name ?? UNKNOWN_PERSON_LABEL,
        count: p.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    errorsByCode,
    rateLimitCount: errorsByCode.find((e) => e.code === 'AI_RATE_LIMITED')?.count ?? 0,
    unpricedModels: findUnpricedModels(byModel.map((m) => m.model)),
  }
}

export async function getUsageAnalytics(
  db: ServerDb,
  days: UsageRangeDays = 30,
  now: Date = new Date(),
): Promise<UsageAnalytics> {
  const fromIso = new Date(
    new Date(jstDayStartIso(now)).getTime() - (days - 1) * DAY_MS,
  ).toISOString()

  const { data, error, status, statusText } = await db.rpc('admin_usage_analytics', {
    p_from: fromIso,
  })
  if (error) throw queryError('getUsageAnalytics', error, { status, statusText })

  return buildAnalytics(data as unknown as UsageAnalyticsRaw, days, now)
}
