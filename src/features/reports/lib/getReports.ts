/** @file
 * 機能: レポート一覧・単一取得（管理画面 SCR-07/08/09 用、生徒名を結合）
 * 入力: Supabase クライアント（Service Role）、一覧はフィルタ（生徒/月/状態）
 * 出力: reports 行（persons.name を結合）
 * 例外: DB エラーは上位に伝播
 * 依存: reports, persons
 * セキュリティ: スタッフのみ（呼び出し元ページが認証済み）
 * @implements FR-16
 */
import type { ServerDb, Tables } from '@shared/types/db'

export type ReportWithPerson = Tables<'reports'> & {
  persons: { name: string } | null
}

export interface ReportFilters {
  /** persons.id（UUID） */
  personId?: string
  /** 'YYYY-MM' 形式（input[type=month] の値） */
  month?: string
  /** ai_draft / draft / approved / sent */
  status?: string
}

export async function getReports(
  db: ServerDb,
  filters: ReportFilters = {},
): Promise<ReportWithPerson[]> {
  let query = db
    .from('reports')
    .select('*, persons(name)')
    .order('report_month', { ascending: false })
    .order('updated_at', { ascending: false })

  if (filters.personId) query = query.eq('person_id', filters.personId)
  if (filters.month) query = query.eq('report_month', `${filters.month}-01`)
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as ReportWithPerson[]
}

export async function getReport(db: ServerDb, id: string): Promise<ReportWithPerson | null> {
  const { data, error } = await db
    .from('reports')
    .select('*, persons(name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as ReportWithPerson | null
}
