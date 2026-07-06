/** @file
 * 機能: チャンネル紐付け一覧（管理画面 SCR-05 用、生徒名を結合）
 * 入力: Supabase クライアント（Service Role）
 * 出力: 紐付け行（persons.name を結合）
 * 例外: DB エラーは上位に伝播
 * 依存: slack_channel_bindings, persons
 * @implements FR-15
 */
import type { ServerDb, Tables } from '@shared/types/db'

export type BindingWithPerson = Tables<'slack_channel_bindings'> & {
  persons: { name: string } | null
}

export async function getBindings(db: ServerDb): Promise<BindingWithPerson[]> {
  const { data, error } = await db
    .from('slack_channel_bindings')
    .select('*, persons(name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as BindingWithPerson[]
}
