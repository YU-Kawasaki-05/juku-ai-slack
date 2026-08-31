/** @file
 * 機能: slack_channel_id から生徒紐付けを検索し、生徒側の在籍状態も併せて判定する
 * 入力: Supabase クライアント（Service Role）, channelId
 * 出力: { status: 'active'|'inactive'|'person_inactive'|'none', binding }
 * 例外: DB エラーは上位に伝播
 * 依存: slack_channel_bindings テーブル, persons テーブル（status のみ）
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
  // H-6: 生徒の在籍状態も 1 クエリで引く（ACK は 3 秒以内。往復を増やさない）
  const { data, error } = await db
    .from('slack_channel_bindings')
    .select('*, persons(status)')
    .eq('slack_channel_id', channelId)
    .maybeSingle()

  if (error) throw error
  if (!data) return { status: 'none', binding: null }

  // 埋め込んだ persons は binding 行の一部ではないので剥がす（呼び出し側は binding の列だけ使う）
  const { persons, ...binding } = data
  const personStatus = (persons as { status: string } | null)?.status ?? null

  // BR-07-03: binding が inactive なら「紐付けなし」と同等に扱う（案内文言を返す）
  if (binding.status !== 'active') {
    return { status: 'inactive', binding }
  }
  // H-6: 退塾生（persons.status = inactive）は binding が生きていても Bot を応答させない。
  // binding 側の inactive と区別するのは、退塾生チャンネルには案内すら投稿しないため（無言 ignore）
  if (personStatus !== null && personStatus !== 'active') {
    return { status: 'person_inactive', binding }
  }
  return { status: 'active', binding }
}
