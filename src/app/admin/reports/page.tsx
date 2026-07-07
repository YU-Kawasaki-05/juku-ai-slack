/** @file
 * 機能: レポート一覧（SCR-07）。生徒/対象月/状態でフィルタ
 * @implements FR-16
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, FileText, Plus } from 'lucide-react'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getPersons } from '@features/persons'
import { getReports, REPORT_STATUSES } from '@features/reports'
import { ReportsFilter } from '@features/reports/components/ReportsFilter'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { formatDate, formatMonth } from '@/components/admin/formatDate'

export const metadata: Metadata = { title: 'レポート管理' }

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; month?: string; status?: string }>
}) {
  const sp = await searchParams
  // 無効なクエリ値はフィルタなしとして扱う
  const filters = {
    personId: sp.person && /^[0-9a-f-]{36}$/i.test(sp.person) ? sp.person : undefined,
    month: sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : undefined,
    status: sp.status && (REPORT_STATUSES as readonly string[]).includes(sp.status)
      ? sp.status
      : undefined,
  }

  const db = createServerClient()
  const [reports, persons] = await Promise.all([getReports(db, filters), getPersons(db)])
  const hasFilter = Boolean(filters.personId || filters.month || filters.status)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">レポート管理</h1>
          <p className="text-sm text-muted-foreground">
            月次学習レポートの作成・承認。承認済みのレポートは Bot の回答に活用されます（全{' '}
            {reports.length} 件）
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/reports/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            新規レポート
          </Link>
        </Button>
      </div>

      <ReportsFilter
        persons={persons.map((p) => ({ id: p.id, name: p.name }))}
        value={filters}
      />

      {reports.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <FileText className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">
              {hasFilter ? '条件に一致するレポートがありません' : 'レポートがまだありません'}
            </p>
            <p className="text-sm text-muted-foreground">
              {hasFilter
                ? 'フィルタ条件を変更してお試しください'
                : '月次レポートを作成して承認すると、Bot が回答の参考にできるようになります'}
            </p>
          </div>
          {!hasFilter && (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/reports/new">レポートを作成する</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>生徒</TableHead>
                <TableHead>対象月</TableHead>
                <TableHead>タイトル</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>AI参照</TableHead>
                <TableHead>更新日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      href={`/admin/reports/${r.id}`}
                      className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {r.persons?.name ?? '—'}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatMonth(r.report_month)}
                  </TableCell>
                  <TableCell className="max-w-64 truncate" title={r.title}>
                    {r.title}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    {r.is_ai_reference ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        対象
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">対象外</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatDate(r.updated_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
