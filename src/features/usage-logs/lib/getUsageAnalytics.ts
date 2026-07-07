/** @file
 * 機能: 利用状況ダッシュボード（SCR-10 / FR-18）の集計
 * 入力: Supabase クライアント（Service Role）、期間（日数）、基準時刻（テスト用に注入可）
 * 出力: UsageAnalytics（サマリー / 日別 / モデル別 / 生徒別 / エラーコード別）
 * 例外: DB エラーは queryError で文脈付きに変換して伝播
 * 依存: ai_usage_logs, ai_error_logs, persons
 * 備考: 集計は期間内の行を取得して JS 集計（50名・月50件規模のため十分）。
 *   「日」は JST 基準（サーバー TZ 非依存）。集計ロジックは aggregateUsage に分離しテスト可能にする
 * @implements FR-18
 */
import type { ServerDb } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'
import { jstDayStartIso } from './getUsageSummary'

const JST_OFFSET_MS = 9 * 3600_000
const DAY_MS = 86_400_000

/** 期間フィルタの選択肢（日数） */
export const USAGE_RANGES = [7, 30, 90] as const
export type UsageRangeDays = (typeof USAGE_RANGES)[number]

export interface UsageRow {
  person_id: string
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost: number
  has_image: boolean
  created_at: string
  persons: { name: string } | null
}

export interface ErrorRow {
  error_code: string
  created_at: string
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
  /** 質問数トップ（最大 10 件、多い順） */
  byPerson: { name: string; count: number }[]
  /** 発生数の多い順 */
  errorsByCode: { code: string; count: number }[]
  rateLimitCount: number
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

/** 純関数の集計本体（DB 非依存・テスト対象） */
export function aggregateUsage(
  usageRows: UsageRow[],
  errorRows: ErrorRow[],
  days: number,
  now: Date,
): UsageAnalytics {
  const totals = {
    questionCount: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    imageCount: 0,
  }

  const dayKeys = buildDayKeys(days, now)
  const dailyMap = new Map<string, { count: number; costUsd: number; tokens: number }>()
  for (const key of dayKeys) dailyMap.set(key, { count: 0, costUsd: 0, tokens: 0 })

  const modelMap = new Map<string, { count: number; costUsd: number }>()
  const personMap = new Map<string, number>()

  for (const row of usageRows) {
    totals.questionCount += 1
    totals.costUsd += row.estimated_cost ?? 0
    totals.inputTokens += row.input_tokens ?? 0
    totals.outputTokens += row.output_tokens ?? 0
    totals.totalTokens += row.total_tokens ?? 0
    if (row.has_image) totals.imageCount += 1

    const dayKey = jstDateKey(row.created_at)
    const day = dailyMap.get(dayKey)
    // 期間外（境界の取りこぼし）は日別に加算しない
    if (day) {
      day.count += 1
      day.costUsd += row.estimated_cost ?? 0
      day.tokens += row.total_tokens ?? 0
    }

    const model = modelMap.get(row.model) ?? { count: 0, costUsd: 0 }
    model.count += 1
    model.costUsd += row.estimated_cost ?? 0
    modelMap.set(row.model, model)

    const name = row.persons?.name ?? '（不明）'
    personMap.set(name, (personMap.get(name) ?? 0) + 1)
  }

  const errorCodeMap = new Map<string, number>()
  let rateLimitCount = 0
  for (const err of errorRows) {
    errorCodeMap.set(err.error_code, (errorCodeMap.get(err.error_code) ?? 0) + 1)
    if (err.error_code === 'AI_RATE_LIMITED') rateLimitCount += 1
  }

  return {
    rangeDays: days,
    totals,
    daily: dayKeys.map((date) => ({
      date,
      label: monthDayLabel(date),
      ...dailyMap.get(date)!,
    })),
    byModel: [...modelMap.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.count - a.count),
    byPerson: [...personMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    errorsByCode: [...errorCodeMap.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    rateLimitCount,
  }
}

export async function getUsageAnalytics(
  db: ServerDb,
  days: UsageRangeDays = 30,
  now: Date = new Date(),
): Promise<UsageAnalytics> {
  const fromMs = new Date(jstDayStartIso(now)).getTime() - (days - 1) * DAY_MS
  const fromIso = new Date(fromMs).toISOString()

  const [usageRes, errorRes] = await Promise.all([
    db
      .from('ai_usage_logs')
      .select(
        'person_id, model, input_tokens, output_tokens, total_tokens, estimated_cost, has_image, created_at, persons(name)',
      )
      .gte('created_at', fromIso),
    db.from('ai_error_logs').select('error_code, created_at').gte('created_at', fromIso),
  ])
  if (usageRes.error)
    throw queryError('getUsageAnalytics(usage)', usageRes.error, {
      status: usageRes.status,
      statusText: usageRes.statusText,
    })
  if (errorRes.error)
    throw queryError('getUsageAnalytics(errors)', errorRes.error, {
      status: errorRes.status,
      statusText: errorRes.statusText,
    })

  return aggregateUsage(
    (usageRes.data ?? []) as unknown as UsageRow[],
    (errorRes.data ?? []) as unknown as ErrorRow[],
    days,
    now,
  )
}
