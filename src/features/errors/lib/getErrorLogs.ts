/** @file
 * 機能: エラーログ一覧・単一取得（管理画面 SCR-11/12 用。生徒名・チャンネル名を解決）
 * 入力: Supabase クライアント（Service Role）、一覧はフィルタ（severity/対応状況/件数）
 * 出力: ai_error_logs 行（persons.name 結合 + channelName 解決済み）
 * 例外: DB エラーは上位に伝播
 * 依存: ai_error_logs, persons, slack_channel_bindings
 * セキュリティ: raw_error は返すが UI では表示しない（BR-17-01）
 * @implements FR-17, AC-17-01, BR-17-02
 */
import type { ServerDb, Tables } from '@shared/types/db'

export type ErrorLogWithPerson = Tables<'ai_error_logs'> & {
  persons: { name: string } | null
  /** slack_channel_bindings から解決した表示名（未紐付けなら null） */
  channelName: string | null
}

export interface ErrorLogFilters {
  /** 'error' | 'warning' | 'info' | 'all'。未指定は error+warning（BR-17-02: info を既定で除外） */
  severity?: string
  /** true=対応済みのみ / false=未対応のみ。未指定は両方 */
  resolved?: boolean
  /** ダッシュボードの「最近のエラー」用 */
  limit?: number
}

/** slack_channel_id → 表示名。ai_error_logs は名前を持たないため bindings から解決する */
async function resolveChannelNames(
  db: ServerDb,
  channelIds: string[],
): Promise<Map<string, string>> {
  if (channelIds.length === 0) return new Map()
  const { data, error } = await db
    .from('slack_channel_bindings')
    .select('slack_channel_id, slack_channel_name')
    .in('slack_channel_id', channelIds)
  if (error) throw error
  const map = new Map<string, string>()
  for (const b of data ?? []) {
    if (b.slack_channel_name) map.set(b.slack_channel_id, b.slack_channel_name)
  }
  return map
}

function attachChannelNames<T extends { slack_channel_id: string | null }>(
  rows: T[],
  names: Map<string, string>,
): (T & { channelName: string | null })[] {
  return rows.map((r) => ({
    ...r,
    channelName: r.slack_channel_id ? (names.get(r.slack_channel_id) ?? null) : null,
  }))
}

export async function getErrorLogs(
  db: ServerDb,
  filters: ErrorLogFilters = {},
): Promise<ErrorLogWithPerson[]> {
  let query = db
    .from('ai_error_logs')
    .select('*, persons(name)')
    .order('created_at', { ascending: false })

  if (filters.severity === 'all') {
    // 全 severity
  } else if (filters.severity) {
    query = query.eq('severity', filters.severity)
  } else {
    // BR-17-02: 既定では info を表示しない
    query = query.in('severity', ['error', 'warning'])
  }
  if (filters.resolved !== undefined) query = query.eq('resolved', filters.resolved)
  if (filters.limit) query = query.limit(filters.limit)

  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []) as unknown as (Tables<'ai_error_logs'> & {
    persons: { name: string } | null
  })[]

  const names = await resolveChannelNames(db, [
    ...new Set(rows.map((r) => r.slack_channel_id).filter((v): v is string => Boolean(v))),
  ])
  return attachChannelNames(rows, names)
}

export async function getErrorLog(db: ServerDb, id: string): Promise<ErrorLogWithPerson | null> {
  const { data, error } = await db
    .from('ai_error_logs')
    .select('*, persons(name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as Tables<'ai_error_logs'> & { persons: { name: string } | null }

  const names = await resolveChannelNames(
    db,
    row.slack_channel_id ? [row.slack_channel_id] : [],
  )
  return attachChannelNames([row], names)[0]
}

/** 未対応（resolved=false, info 除く）の件数。ダッシュボード SCR-02 用 */
export async function countUnresolvedErrors(db: ServerDb): Promise<number> {
  const { count, error } = await db
    .from('ai_error_logs')
    .select('*', { count: 'exact', head: true })
    .eq('resolved', false)
    .in('severity', ['error', 'warning'])
  if (error) throw error
  return count ?? 0
}
