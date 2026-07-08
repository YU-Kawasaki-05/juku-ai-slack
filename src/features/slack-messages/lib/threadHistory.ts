/** @file
 * 機能: スレッドの会話履歴の読込・保存（会話継続のため）
 * 入力: Supabase クライアント, channelId, threadTs ほか
 * 出力: loadThreadHistory → LlmMessage[] / saveMessage → void
 * 例外: DB エラーは上位に伝播（saveMessage は記録失敗を握りつぶさない）
 * 依存: slack_messages テーブル
 * 副作用: saveMessage は行を挿入
 * セキュリティ: person_id は channel_id 解決済みの値のみ保存（BR-05-11）
 * @implements FR-03, FR-05
 */
import type { ServerDb } from '@shared/types/db'
import type { LlmMessage } from '@features/ai-answer'

/**
 * 直近の履歴を古い順に返す（プロンプト用）。上限件数でトリム。
 * person_id でも絞り、チャンネル付け替え等で別生徒の履歴が混入しないようにする（BR-05-11）。
 */
export async function loadThreadHistory(
  db: ServerDb,
  channelId: string,
  threadTs: string,
  personId: string,
  limit = 20,
): Promise<LlmMessage[]> {
  const { data, error } = await db
    .from('slack_messages')
    .select('role, text, created_at')
    .eq('slack_channel_id', channelId)
    .eq('thread_ts', threadTs)
    .eq('person_id', personId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  if (!data) return []

  // 取得は新しい順 → 古い順に戻し、テキストのある user/assistant のみ採用
  return data
    .slice()
    .reverse()
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text as string }))
}

/**
 * スレッドの user/assistant メッセージ総数を数える（要約トリガー判定用, FR-20）。
 * person_id で厳密フィルタ（BR-05-11）。
 */
export async function countThreadMessages(
  db: ServerDb,
  channelId: string,
  threadTs: string,
  personId: string,
): Promise<number> {
  const { count, error } = await db
    .from('slack_messages')
    .select('*', { count: 'exact', head: true })
    .eq('slack_channel_id', channelId)
    .eq('thread_ts', threadTs)
    .eq('person_id', personId)
    .in('role', ['user', 'assistant'])
  if (error) throw error
  return count ?? 0
}

/**
 * 古い順の一定範囲のメッセージを返す（要約対象ウィンドウの取得用, FR-20）。
 * offset から limit 件（asc）。text のある user/assistant のみ整形。
 */
export async function loadMessageRange(
  db: ServerDb,
  channelId: string,
  threadTs: string,
  personId: string,
  offset: number,
  limit: number,
): Promise<LlmMessage[]> {
  const { data, error } = await db
    .from('slack_messages')
    .select('role, text, created_at')
    .eq('slack_channel_id', channelId)
    .eq('thread_ts', threadTs)
    .eq('person_id', personId)
    // count（countThreadMessages）と母集合を揃える（offset のズレ防止）
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw error
  if (!data) return []
  return data
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text as string }))
}

export interface SaveMessageParams {
  teamId: string
  channelId: string
  threadTs: string
  messageTs: string
  slackUserId?: string | null
  personId?: string | null
  role: 'user' | 'assistant'
  text: string | null
  hasAttachments?: boolean
}

export async function saveMessage(db: ServerDb, params: SaveMessageParams): Promise<void> {
  const { error } = await db.from('slack_messages').insert({
    slack_team_id: params.teamId,
    slack_channel_id: params.channelId,
    thread_ts: params.threadTs,
    message_ts: params.messageTs,
    slack_user_id: params.slackUserId ?? null,
    person_id: params.personId ?? null,
    role: params.role,
    text: params.text,
    has_attachments: params.hasAttachments ?? false,
  })
  if (error) throw error
}
