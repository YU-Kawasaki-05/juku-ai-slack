/** @file
 * 機能: スレッドの AI 会話セッションを取得（なければ作成）する
 * 入力: Supabase クライアント, { teamId, channelId, threadTs, personId, reportId }
 * 出力: slack_thread_sessions の行
 * 例外: DB エラーは上位に伝播
 * 依存: slack_thread_sessions テーブル（unique (slack_channel_id, thread_ts)）
 * 副作用: 行の作成 or last_message_at 更新
 * セキュリティ: person_id は channel_id 解決済みの値のみ受け取る（FR-07）
 * @implements FR-03, AC-03-01, AC-03-02, AC-03-03
 */
import type { ServerDb, Tables, TablesInsert } from '@shared/types/db'

export interface GetOrCreateSessionParams {
  teamId: string
  channelId: string
  /** スレッド親 ts（直下メッセージなら message_ts 自身）。セッションの一意キー */
  threadTs: string
  personId: string
  reportId: string | null
  /** last_message_at に設定する時刻（ISO 文字列）。省略時は DB 側 now() 相当を呼び出し側で指定 */
  nowIso: string
}

/**
 * (slack_channel_id, thread_ts) を一意キーに UPSERT する。
 * 同時到達（AC-03-03）でも unique 制約により 1 行に収束する。
 * 既存があれば last_message_at を更新して返す（AC-03-02）。
 */
export async function getOrCreateSession(
  db: ServerDb,
  params: GetOrCreateSessionParams,
): Promise<Tables<'slack_thread_sessions'>> {
  const row: TablesInsert<'slack_thread_sessions'> = {
    slack_team_id: params.teamId,
    slack_channel_id: params.channelId,
    root_message_ts: params.threadTs,
    thread_ts: params.threadTs,
    person_id: params.personId,
    report_id: params.reportId,
    status: 'active',
    last_message_at: params.nowIso,
  }

  const { data, error } = await db
    .from('slack_thread_sessions')
    .upsert(row, { onConflict: 'slack_channel_id,thread_ts' })
    .select('*')
    .single()

  if (error) throw error
  return data
}
