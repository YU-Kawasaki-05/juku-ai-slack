/** @file
 * 機能: 生徒一覧・単一取得（管理画面 SCR-03/04 用）
 * 入力: Supabase クライアント（Service Role, サーバー専用）、includeInactive（既定 false）
 * 出力: persons 行
 * 例外: DB エラーは上位に伝播
 * 依存: persons テーブル
 * 副作用: なし
 * 備考: 既定では status='active' のみ返す。「無効にした生徒は集計・レポートの対象から外れます」
 *   という SCR-04 の説明どおりに実装を寄せたもの（H-6）。
 *   生徒一覧画面のようにステータス列を持ち全件を見せたい画面だけ includeInactive:true を渡す
 * セキュリティ: スタッフのみ（呼び出し元ページが認証済み）。生徒間フィルタは不要（全生徒を管理）
 * @implements FR-14, AC-14-01
 */
import type { ServerDb, Tables } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'

export interface GetPersonsOptions {
  /** true で inactive も含める（一覧画面のみ）。既定は active のみ */
  includeInactive?: boolean
}

export async function getPersons(
  db: ServerDb,
  { includeInactive = false }: GetPersonsOptions = {},
): Promise<Tables<'persons'>[]> {
  let query = db.from('persons').select('*').order('created_at', { ascending: false })
  if (!includeInactive) query = query.eq('status', 'active')
  const { data, error } = await query
  if (error) throw queryError('getPersons', error)
  return data ?? []
}

/** 有効な生徒数（ダッシュボードのカード用。全件取得せず count のみ） */
export async function countActivePersons(db: ServerDb): Promise<number> {
  const { count, error, status, statusText } = await db
    .from('persons')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
  if (error) throw queryError('countActivePersons', error, { status, statusText })
  return count ?? 0
}

export async function getPerson(
  db: ServerDb,
  id: string,
): Promise<Tables<'persons'> | null> {
  const { data, error } = await db.from('persons').select('*').eq('id', id).maybeSingle()
  if (error) throw queryError('getPerson', error)
  return data
}
