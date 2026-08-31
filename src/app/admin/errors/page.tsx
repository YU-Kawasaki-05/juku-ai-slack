/** @file
 * 機能: エラー一覧（SCR-11）。severity/対応状況でフィルタ。対応済み行は薄く表示（AC-17-02）
 * @implements FR-17, AC-17-01, AC-17-02, BR-17-02
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getErrorLogs, ERROR_SEVERITIES } from '@features/errors'
import { ErrorsFilter } from '@features/errors/components/ErrorsFilter'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { formatDateTime } from '@/components/admin/formatDate'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'エラー管理' }

export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; resolved?: string }>
}) {
  const sp = await searchParams
  const severity =
    sp.severity &&
    ([...ERROR_SEVERITIES, 'all'] as readonly string[]).includes(sp.severity)
      ? sp.severity
      : undefined
  const resolvedParam = sp.resolved === 'true' || sp.resolved === 'false' ? sp.resolved : undefined

  const logs = await getErrorLogs(createServerClient(), {
    severity,
    resolved: resolvedParam === undefined ? undefined : resolvedParam === 'true',
  })
  const hasFilter = Boolean(severity || resolvedParam)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">エラー管理</h1>
        <p className="text-sm text-muted-foreground">
          Bot の処理で発生したエラーの確認と対応記録（表示中 {logs.length} 件）
        </p>
      </div>

      <ErrorsFilter value={{ severity, resolved: resolvedParam }} />

      {logs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">
              {hasFilter ? '条件に一致するエラーがありません' : 'エラーはありません'}
            </p>
            <p className="text-sm text-muted-foreground">
              {hasFilter
                ? 'フィルタ条件を変更してお試しください'
                : 'Bot の処理でエラーが発生するとここに記録されます'}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>エラーコード</TableHead>
                <TableHead>生徒</TableHead>
                <TableHead>チャンネル</TableHead>
                <TableHead>深刻度</TableHead>
                <TableHead>対応状況</TableHead>
                <TableHead>発生日時</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id} className={cn(log.resolved && 'opacity-60')}>
                  <TableCell>
                    <Link
                      href={`/admin/errors/${log.id}`}
                      className="rounded-sm font-mono text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {log.error_code}
                    </Link>
                  </TableCell>
                  <TableCell>{log.persons?.name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {log.channelName
                      ? `#${log.channelName}`
                      : (log.slack_channel_id ?? '—')}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={log.severity} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={log.resolved ? 'resolved' : 'unresolved'} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatDateTime(log.created_at)}
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
