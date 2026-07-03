/** @file
 * 機能: (channel_id, thread_ts) でスレッドセッションの存在を確認する
 * 入力: Supabase クライアント, channelId, threadTs
 * 出力: セッション行 or null
 * 例外: DB エラーは上位に伝播
 * 依存: slack_thread_sessions テーブル
 * 副作用: なし（読み取りのみ）
 * @implements FR-02, FR-03, AC-02-03, AC-02-04
 */
import type { ServerDb, Tables } from '@shared/types/db'

export async function findSession(
  db: ServerDb,
  channelId: string,
  threadTs: string,
): Promise<Tables<'slack_thread_sessions'> | null> {
  const { data, error } = await db
    .from('slack_thread_sessions')
    .select('*')
    .eq('slack_channel_id', channelId)
    .eq('thread_ts', threadTs)
    .maybeSingle()

  if (error) throw error
  return data
}
