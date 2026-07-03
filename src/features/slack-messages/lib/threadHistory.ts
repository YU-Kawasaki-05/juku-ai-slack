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

/** 直近の履歴を古い順に返す（プロンプト用）。上限件数でトリム */
export async function loadThreadHistory(
  db: ServerDb,
  channelId: string,
  threadTs: string,
  limit = 20,
): Promise<LlmMessage[]> {
  const { data, error } = await db
    .from('slack_messages')
    .select('role, text, created_at')
    .eq('slack_channel_id', channelId)
    .eq('thread_ts', threadTs)
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
