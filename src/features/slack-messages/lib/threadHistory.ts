/** @file
 * 機能: スレッドの会話履歴の読込・保存（会話継続のため）
 * 入力: Supabase クライアント, channelId, threadTs ほか
 * 出力: loadThreadHistory → LlmMessage[] / saveMessage → void
 * 例外: DB エラーは上位に伝播（saveMessage は記録失敗を握りつぶさない）
 * 依存: slack_messages テーブル
 * 副作用: saveMessage は行を upsert（自然キー: channel + thread + message_ts + role）
 * セキュリティ: person_id は channel_id 解決済みの値のみ保存（BR-05-11）
 * @implements FR-03, FR-05
 */
import type { ServerDb } from '@shared/types/db'
import type { LlmMessage } from '@features/ai-answer'

/** ページ境界での取りこぼし/重複を防ぐタイブレーカ（A-13）。created_at は同時 INSERT で衝突しうる */
const TIEBREAK_COLUMN = 'id'

/**
 * 直近の履歴を古い順に返す（プロンプト用）。上限件数でトリム。
 * person_id でも絞り、チャンネル付け替え等で別生徒の履歴が混入しないようにする（BR-05-11）。
 *
 * @param excludeMessageTs 今回処理中のメッセージ ts。A-4 で質問を回答生成の前に保存するようになったため、
 *   リトライ時に「今回の質問自身」が履歴に混ざって二重化するのを防ぐ。
 */
export async function loadThreadHistory(
  db: ServerDb,
  channelId: string,
  threadTs: string,
  personId: string,
  limit = 20,
  excludeMessageTs?: string,
): Promise<LlmMessage[]> {
  let query = db
    .from('slack_messages')
    .select('role, text, created_at')
    .eq('slack_channel_id', channelId)
    .eq('thread_ts', threadTs)
    .eq('person_id', personId)
  if (excludeMessageTs) query = query.neq('message_ts', excludeMessageTs)

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order(TIEBREAK_COLUMN, { ascending: false })
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
  excludeMessageTs?: string,
): Promise<LlmMessage[]> {
  let query = db
    .from('slack_messages')
    .select('role, text, created_at')
    .eq('slack_channel_id', channelId)
    .eq('thread_ts', threadTs)
    .eq('person_id', personId)
    // count（countThreadMessages）と母集合を揃える（offset のズレ防止）
    .in('role', ['user', 'assistant'])
  if (excludeMessageTs) query = query.neq('message_ts', excludeMessageTs)

  const { data, error } = await query
    .order('created_at', { ascending: true })
    .order(TIEBREAK_COLUMN, { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw error
  if (!data) return []
  return data
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text as string }))
}

/**
 * 要約済み接頭辞より後ろの「未要約のしっぽ」を返す（FR-20 の履歴側）。
 *
 * A-12: 要約が連続で失敗して しっぽが maxMessages を超えたとき、
 * 古い方から maxMessages 件を取ると直近のやり取りが履歴から落ちて会話が噛み合わなくなる。
 * 上限に当たる場合は「新しい方から maxMessages 件」を返す。
 */
export async function loadThreadTail(
  db: ServerDb,
  channelId: string,
  threadTs: string,
  personId: string,
  summarizedCount: number,
  maxMessages: number,
  excludeMessageTs?: string,
): Promise<LlmMessage[]> {
  const total = await countThreadMessages(db, channelId, threadTs, personId)
  const start = Math.max(summarizedCount, total - maxMessages)
  return loadMessageRange(db, channelId, threadTs, personId, start, maxMessages, excludeMessageTs)
}

/**
 * 指定メッセージの「直前の assistant 発言」を返す（A-9 / FR-23 Evaluator 用）。
 *
 * 履歴末尾の assistant を使うと、並行ジョブが先に書いた「未来の回答」を
 * 生徒返信の評価対象にしてしまう（無関係な問いに対する評価が BKT に入る）。
 * message_ts は Slack の単調増加タイムスタンプなので辞書順比較で前後を判定できる。
 */
export async function loadPrecedingAssistantText(
  db: ServerDb,
  channelId: string,
  threadTs: string,
  personId: string,
  beforeMessageTs: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('slack_messages')
    .select('text, message_ts')
    .eq('slack_channel_id', channelId)
    .eq('thread_ts', threadTs)
    .eq('person_id', personId)
    .eq('role', 'assistant')
    .lt('message_ts', beforeMessageTs)
    .order('message_ts', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0]?.text ?? null
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

/**
 * 会話履歴を保存する。
 * A-4: ジョブのリトライで同じ行を書き直しても重複しないよう、自然キーで upsert する
 * （migration 028 の UNIQUE(slack_channel_id, thread_ts, message_ts, role)）。
 */
export async function saveMessage(db: ServerDb, params: SaveMessageParams): Promise<void> {
  const { error } = await db.from('slack_messages').upsert(
    {
      slack_team_id: params.teamId,
      slack_channel_id: params.channelId,
      thread_ts: params.threadTs,
      message_ts: params.messageTs,
      slack_user_id: params.slackUserId ?? null,
      person_id: params.personId ?? null,
      role: params.role,
      text: params.text,
      has_attachments: params.hasAttachments ?? false,
    },
    { onConflict: 'slack_channel_id,thread_ts,message_ts,role' },
  )
  if (error) throw error
}
