/** @file
 * 機能: 会話ログの閲覧（SCR-13 / FR-19）。Slack スレッド単位の会話を管理画面で参照
 * 入力: Supabase クライアント（Service Role）、フィルタ（生徒 / 期間 / 画像有無 / モデル / エラー有無）
 * 出力: スレッド一覧（生徒名・チャンネル名・件数・メタ付き）/ スレッド詳細（メッセージ時系列）
 * 例外: DB エラーは queryError で文脈付きに変換して伝播
 * 依存: slack_thread_sessions, slack_messages, ai_usage_logs, ai_error_logs, persons, slack_channel_bindings
 * セキュリティ: 会話本文は PII。閲覧はスタッフ/管理者のみ（ページが認証済み・middleware 保護）。
 *   別生徒の履歴混入を防ぐため詳細は person_id + channel_id + thread_ts で厳密に絞る（BR-05-11）
 * @implements FR-19
 */
import type { ServerDb, Tables } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'

const JST_OFFSET_MS = 9 * 3600_000
const DAY_MS = 86_400_000

export const CONVERSATION_RANGES = [7, 30, 90] as const
export type ConversationRangeDays = (typeof CONVERSATION_RANGES)[number]

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
}

/** スレッド1件分の集計メタ */
export interface ThreadMeta {
  count: number
  hasImage: boolean
  hasError: boolean
  models: string[]
}

export type ThreadListItem = Tables<'slack_thread_sessions'> & {
  persons: { name: string } | null
  channelName: string | null
  messageCount: number
  hasImage: boolean
  hasError: boolean
  models: string[]
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

/** チャンネル×スレッドを一意キーにする（thread_ts はチャンネル内一意） */
function threadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`
}

/**
 * メッセージ・利用ログ・エラーログからスレッド単位のメタ（件数・画像有無・モデル・エラー有無）を集計する。
 * 純関数（DB 非依存・テスト対象）。
 */
export function buildThreadMeta(
  messages: { slack_channel_id: string | null; thread_ts: string | null; has_attachments: boolean }[],
  usage: { slack_channel_id: string | null; thread_ts: string | null; model: string | null }[],
  errors: { slack_channel_id: string | null; thread_ts: string | null }[],
): Map<string, ThreadMeta> {
  const map = new Map<string, ThreadMeta>()
  const ensure = (ch: string, ts: string): ThreadMeta => {
    const key = threadKey(ch, ts)
    let m = map.get(key)
    if (!m) {
      m = { count: 0, hasImage: false, hasError: false, models: [] }
      map.set(key, m)
    }
    return m
  }
  for (const r of messages) {
    if (!r.slack_channel_id || !r.thread_ts) continue
    const m = ensure(r.slack_channel_id, r.thread_ts)
    m.count += 1
    if (r.has_attachments) m.hasImage = true
  }
  for (const u of usage) {
    if (!u.slack_channel_id || !u.thread_ts) continue
    const m = ensure(u.slack_channel_id, u.thread_ts)
    if (u.model && !m.models.includes(u.model)) m.models.push(u.model)
  }
  for (const e of errors) {
    if (!e.slack_channel_id || !e.thread_ts) continue
    ensure(e.slack_channel_id, e.thread_ts).hasError = true
  }
  return map
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

/** フィルタ選択肢用: これまでに利用されたモデル一覧（昇順・重複排除） */
export async function getUsedModels(db: ServerDb): Promise<string[]> {
  const { data, error } = await db.from('ai_usage_logs').select('model')
  if (error) throw queryError('getUsedModels', error)
  return [...new Set((data ?? []).map((r) => r.model).filter((m): m is string => Boolean(m)))].sort()
}

export async function getThreads(
  db: ServerDb,
  filters: ConversationFilters = {},
): Promise<ThreadListItem[]> {
  // 集計後にメタでも絞り込むため、まず広めに取得する
  const limit = filters.limit ?? 500
  let query = db
    .from('slack_thread_sessions')
    .select('*, persons(name)')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (filters.personId) query = query.eq('person_id', filters.personId)
  if (filters.days) {
    const fromIso = new Date(Date.now() - filters.days * DAY_MS).toISOString()
    query = query.gte('last_message_at', fromIso)
  }

  const { data, error, status, statusText } = await query
  if (error) throw queryError('getThreads', error, { status, statusText })
  const sessions = (data ?? []) as unknown as (Tables<'slack_thread_sessions'> & {
    persons: { name: string } | null
  })[]
  if (sessions.length === 0) return []

  const channelIds = [...new Set(sessions.map((s) => s.slack_channel_id))]
  const threadTsList = [...new Set(sessions.map((s) => s.thread_ts))]

  const [msgRes, usageRes, errRes, channelNames] = await Promise.all([
    db.from('slack_messages').select('slack_channel_id, thread_ts, has_attachments').in('thread_ts', threadTsList),
    db.from('ai_usage_logs').select('slack_channel_id, thread_ts, model').in('thread_ts', threadTsList),
    db.from('ai_error_logs').select('slack_channel_id, thread_ts').in('thread_ts', threadTsList),
    resolveChannelNames(db, channelIds),
  ])
  if (msgRes.error) throw queryError('getThreads(messages)', msgRes.error)
  if (usageRes.error) throw queryError('getThreads(usage)', usageRes.error)
  if (errRes.error) throw queryError('getThreads(errors)', errRes.error)

  const meta = buildThreadMeta(msgRes.data ?? [], usageRes.data ?? [], errRes.data ?? [])

  let items: ThreadListItem[] = sessions.map((s) => {
    const m = meta.get(threadKey(s.slack_channel_id, s.thread_ts)) ?? {
      count: 0,
      hasImage: false,
      hasError: false,
      models: [],
    }
    return {
      ...s,
      channelName: channelNames.get(s.slack_channel_id) ?? null,
      messageCount: m.count,
      hasImage: m.hasImage,
      hasError: m.hasError,
      models: m.models,
    }
  })

  if (filters.hasImage) items = items.filter((i) => i.hasImage)
  if (filters.hasError) items = items.filter((i) => i.hasError)
  if (filters.model) items = items.filter((i) => i.models.includes(filters.model!))

  return items
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
