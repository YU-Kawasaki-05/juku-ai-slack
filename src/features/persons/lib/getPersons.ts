/** @file
 * 機能: 生徒一覧・単一取得（管理画面 SCR-03/04 用）
 * 入力: Supabase クライアント（Service Role, サーバー専用）
 * 出力: persons 行
 * 例外: DB エラーは上位に伝播
 * 依存: persons テーブル
 * 副作用: なし
 * セキュリティ: スタッフのみ（呼び出し元ページが認証済み）。生徒間フィルタは不要（全生徒を管理）
 * @implements FR-14, AC-14-01
 */
import type { ServerDb, Tables } from '@shared/types/db'

export async function getPersons(db: ServerDb): Promise<Tables<'persons'>[]> {
  const { data, error } = await db
    .from('persons')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getPerson(
  db: ServerDb,
  id: string,
): Promise<Tables<'persons'> | null> {
  const { data, error } = await db.from('persons').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}
