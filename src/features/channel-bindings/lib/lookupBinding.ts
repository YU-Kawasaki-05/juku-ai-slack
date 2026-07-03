/** @file
 * 機能: slack_channel_id から生徒紐付けを検索する
 * 入力: Supabase クライアント（Service Role）, channelId
 * 出力: { status: 'active'|'inactive'|'none', binding }
 * 例外: DB エラーは上位に伝播
 * 依存: slack_channel_bindings テーブル
 * 副作用: なし（読み取りのみ）
 * セキュリティ: channel_id を信頼の基点にする（BR-07-01）。channel_name では検索しない
 * @implements FR-07, AC-07-01, AC-07-02, AC-07-03
 */
import type { ServerDb, Tables } from '@shared/types/db'
import type { BindingStatus } from '@features/slack-events/types'

export interface LookupBindingResult {
  status: BindingStatus
  binding: Tables<'slack_channel_bindings'> | null
}

export async function lookupBinding(
  db: ServerDb,
  channelId: string,
): Promise<LookupBindingResult> {
  const { data, error } = await db
    .from('slack_channel_bindings')
    .select('*')
    .eq('slack_channel_id', channelId)
    .maybeSingle()

  if (error) throw error
  if (!data) return { status: 'none', binding: null }

  // BR-07-03: inactive は「紐付けなし」と同等に扱う
  const status: BindingStatus = data.status === 'active' ? 'active' : 'inactive'
  return { status, binding: data }
}
