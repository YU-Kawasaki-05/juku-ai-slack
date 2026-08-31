/** @file
 * 機能: 会話ログの閲覧（SCR-13 / FR-19）。Slack スレッド単位の会話を管理画面で参照
 * 入力: Supabase クライアント（Service Role）、フィルタ（生徒 / 期間 / 画像有無 / モデル / エラー有無 / ページング）
 * 出力: スレッド一覧（生徒名・チャンネル名・件数・メタ付き）/ スレッド詳細（メッセージ時系列）
 * 例外: DB エラーは queryError で文脈付きに変換して伝播
 * 依存: RPC admin_thread_list / admin_used_models（migration 029）, slack_thread_sessions, slack_messages
 * 備考: 一覧の集計は SQL 側（LATERAL）。以前は「セッション 500 件の thread_ts を .in() に並べる」
 *   構造だったため、スレッドが 300-400 件を超えると URL 長で HTTP 414 になり一覧が落ちていた（H-3 / E-4）。
 * セキュリティ: 会話本文は PII。閲覧はスタッフ/管理者のみ（ページが認証済み・middleware 保護）。
 *   RPC は SECURITY DEFINER + service_role のみ EXECUTE。
 *   別生徒の履歴混入を防ぐため詳細は person_id + channel_id + thread_ts で厳密に絞る（BR-05-11）
 * @implements FR-19
 */
import type { ServerDb, Tables } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'
import { jstDayStartIso } from '@features/usage-logs/lib/getUsageSummary'

const JST_OFFSET_MS = 9 * 3600_000
const DAY_MS = 86_400_000

export const CONVERSATION_RANGES = [7, 30, 90] as const
export type ConversationRangeDays = (typeof CONVERSATION_RANGES)[number]

/** 1ページあたりの表示件数 */
export const CONVERSATION_PAGE_SIZE = 100

export interface ConversationFilters {
  personId?: string
  days?: ConversationRangeDays
  /** 画像添付を含むスレッドのみ */
  hasImage?: boolean
  /** エラーが発生したスレッドのみ */
  hasError?: boolean
  /** 指定モデルを使ったスレッドのみ */
  model?: string
  limit?: number
  offset?: number
}

export type ThreadListItem = Tables<'slack_thread_sessions'> & {
  persons: { name: string } | null
  channelName: string | null
  messageCount: number
  hasImage: boolean
  hasError: boolean
  models: string[]
}

export interface ThreadListPage {
  items: ThreadListItem[]
  /** フィルタ適用後・ページング前の総件数 */
  total: number
}

export interface ConversationMessage {
  id: string
  role: string
  text: string | null
  hasAttachments: boolean
  messageTs: string
  createdAt: string
}

export interface ThreadDetail {
  session: Tables<'slack_thread_sessions'> & { persons: { name: string } | null }
  channelName: string | null
  messages: ConversationMessage[]
}

/** admin_thread_list の1行（migration 029 の RETURNS TABLE に対応） */
export interface ThreadListRow {
  id: string
  slack_team_id: string
  slack_channel_id: string
  root_message_ts: string
  thread_ts: string
  person_id: string
  report_id: string | null
  status: string
  thread_summary: string | null
  summary_message_count: number
  created_at: string
  updated_at: string
  last_message_at: string | null
  person_name: string | null
  channel_name: string | null
  message_count: number
  has_image: boolean
  has_error: boolean
  models: string[] | null
  total_count: number
}

/**
 * RPC の平坦な行を画面用の形に整える。純関数（DB 非依存・テスト対象）。
 */
export function mapThreadRows(rows: ThreadListRow[]): ThreadListPage {
  const items = rows.map((r) => ({
    id: r.id,
    slack_team_id: r.slack_team_id,
    slack_channel_id: r.slack_channel_id,
    root_message_ts: r.root_message_ts,
    thread_ts: r.thread_ts,
    person_id: r.person_id,
    report_id: r.report_id,
    status: r.status,
    thread_summary: r.thread_summary,
    summary_message_count: r.summary_message_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_message_at: r.last_message_at,
    persons: r.person_name ? { name: r.person_name } : null,
    channelName: r.channel_name,
    messageCount: r.message_count,
    hasImage: r.has_image,
    hasError: r.has_error,
    models: r.models ?? [],
  }))
  return { items, total: rows[0]?.total_count ?? 0 }
}

/**
 * 「直近N日」の下限を JST 暦日基準で求める（G-8）。
 * 利用状況ダッシュボード（getUsageAnalytics）と同じ定義: 今日を含む過去 N 日。
 * 以前はローリング 24 時間 × N で、2画面の「直近30日」が別物になっていた。
 */
export function conversationRangeFromIso(days: number, now: Date = new Date()): string {
  return new Date(new Date(jstDayStartIso(now)).getTime() - (days - 1) * DAY_MS).toISOString()
}

// TODO: getErrorLogs にも同等の解決がある。channel-bindings 側へ共通化を検討
async function resolveChannelNames(
  db: ServerDb,
  channelIds: string[],
): Promise<Map<string, string>> {
  if (channelIds.length === 0) return new Map()
  const { data, error } = await db
    .from('slack_channel_bindings')
    .select('slack_channel_id, slack_channel_name')
    .in('slack_channel_id', channelIds)
  if (error) throw queryError('resolveChannelNames(conversations)', error)
  const map = new Map<string, string>()
  for (const b of data ?? []) {
    if (b.slack_channel_name) map.set(b.slack_channel_id, b.slack_channel_name)
  }
  return map
}

/** フィルタ選択肢用: これまでに利用されたモデル一覧（昇順・重複排除、DB 側で distinct） */
export async function getUsedModels(db: ServerDb): Promise<string[]> {
  const { data, error } = await db.rpc('admin_used_models')
  if (error) throw queryError('getUsedModels', error)
  return data ?? []
}

export async function getThreads(
  db: ServerDb,
  filters: ConversationFilters = {},
  now: Date = new Date(),
): Promise<ThreadListPage> {
  const { data, error, status, statusText } = await db.rpc('admin_thread_list', {
    p_person_id: filters.personId ?? null,
    p_from: filters.days ? conversationRangeFromIso(filters.days, now) : null,
    p_has_image: filters.hasImage ?? null,
    p_has_error: filters.hasError ?? null,
    p_model: filters.model ?? null,
    p_limit: filters.limit ?? CONVERSATION_PAGE_SIZE,
    p_offset: filters.offset ?? 0,
  })
  if (error) throw queryError('getThreads', error, { status, statusText })
  return mapThreadRows((data ?? []) as unknown as ThreadListRow[])
}

export async function getThreadDetail(db: ServerDb, id: string): Promise<ThreadDetail | null> {
  const { data, error } = await db
    .from('slack_thread_sessions')
    .select('*, persons(name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw queryError('getThreadDetail(session)', error)
  if (!data) return null
  const session = data as unknown as Tables<'slack_thread_sessions'> & {
    persons: { name: string } | null
  }

  const [msgRes, channelNames] = await Promise.all([
    db
      .from('slack_messages')
      .select('id, role, text, has_attachments, message_ts, created_at')
      // BR-05-11: person_id + channel_id + thread_ts で厳密に絞り別生徒混入を防ぐ
      .eq('slack_channel_id', session.slack_channel_id)
      .eq('thread_ts', session.thread_ts)
      .eq('person_id', session.person_id)
      .order('message_ts', { ascending: true }),
    resolveChannelNames(db, [session.slack_channel_id]),
  ])
  if (msgRes.error) throw queryError('getThreadDetail(messages)', msgRes.error)

  const messages: ConversationMessage[] = (msgRes.data ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    hasAttachments: m.has_attachments,
    messageTs: m.message_ts,
    createdAt: m.created_at,
  }))

  return { session, channelName: channelNames.get(session.slack_channel_id) ?? null, messages }
}

/** JST の「M/D HH:mm」表示（詳細のメッセージ時刻用） */
export function formatMessageTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET_MS)
  const mm = d.getUTCMonth() + 1
  const dd = d.getUTCDate()
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}
