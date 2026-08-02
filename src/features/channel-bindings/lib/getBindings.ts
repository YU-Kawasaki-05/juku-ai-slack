/** @file
 * 機能: チャンネル紐付け一覧（管理画面 SCR-05 用、生徒名を結合）
 * 入力: Supabase クライアント（Service Role）
 * 出力: 紐付け行（persons.name を結合）
 * 例外: DB エラーは上位に伝播
 * 依存: slack_channel_bindings, persons
 * @implements FR-15
 */
import type { ServerDb, Tables } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'

export type BindingWithPerson = Tables<'slack_channel_bindings'> & {
  persons: { name: string } | null
  /** default_report_id の参照先（H-11: 一覧列の表示用） */
  reports: { title: string; report_month: string } | null
}

export async function getBindings(db: ServerDb): Promise<BindingWithPerson[]> {
  const { data, error } = await db
    .from('slack_channel_bindings')
    .select('*, persons(name), reports(title, report_month)')
    .order('created_at', { ascending: false })
  if (error) throw queryError('getBindings', error)
  return (data ?? []) as unknown as BindingWithPerson[]
}

export async function getBinding(
  db: ServerDb,
  id: string,
): Promise<BindingWithPerson | null> {
  const { data, error } = await db
    .from('slack_channel_bindings')
    .select('*, persons(name), reports(title, report_month)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw queryError('getBinding', error)
  return (data ?? null) as unknown as BindingWithPerson | null
}
