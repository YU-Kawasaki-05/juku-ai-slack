/** @file
 * 機能: スレッドの AI 会話セッションを取得（なければ作成）する
 * 入力: Supabase クライアント, { teamId, channelId, threadTs, personId, reportId }
 * 出力: slack_thread_sessions の行
 * 例外: DB エラーは上位に伝播
 * 依存: slack_thread_sessions テーブル（unique (slack_channel_id, thread_ts)）
 * 副作用: 行の作成 or last_message_at 更新（既存行の他フィールドは保持）
 * セキュリティ: person_id は channel_id 解決済みの値のみ受け取る（FR-07）
 * @implements FR-03, AC-03-01, AC-03-02, AC-03-03
 */
import type { ServerDb, Tables, TablesInsert } from '@shared/types/db'

/** Postgres unique_violation */
const PG_UNIQUE_VIOLATION = '23505'

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
 * まず INSERT を試み、(slack_channel_id, thread_ts) の unique 制約に衝突したら
 * 既存行の last_message_at のみ更新して返す（AC-03-02）。
 *
 * UPSERT で全カラムを上書きすると既存の status/report_id/person_id を破壊する（closed の復活・
 * report 差し替え）ため採用しない。INSERT の原子性で同時到達（AC-03-03）にも安全。
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

  const inserted = await db.from('slack_thread_sessions').insert(row).select('*').single()

  if (!inserted.error) return inserted.data
  if (inserted.error.code !== PG_UNIQUE_VIOLATION) throw inserted.error

  // 既存セッション: last_message_at のみ更新し、他フィールド（status/report_id 等）は保持
  const updated = await db
    .from('slack_thread_sessions')
    .update({ last_message_at: params.nowIso })
    .eq('slack_channel_id', params.channelId)
    .eq('thread_ts', params.threadTs)
    .select('*')
    .single()

  if (updated.error) throw updated.error
  return updated.data
}
