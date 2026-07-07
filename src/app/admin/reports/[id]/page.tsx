/** @file
 * 機能: レポート詳細（SCR-09）。Markdown 表示・Embedding 状態の警告・手動再生成
 * @implements FR-16, AC-16-03, BR-16-03
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, Bot, Check, Pencil, TriangleAlert } from 'lucide-react'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getReport } from '@features/reports'
import { MarkdownContent } from '@features/reports/components/MarkdownContent'
import { RebuildEmbeddingsButton } from '@features/reports/components/RebuildEmbeddingsButton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { formatDateTime, formatMonth } from '@/components/admin/formatDate'

export const metadata: Metadata = { title: 'レポート詳細' }

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(createServerClient(), id)
  if (!report) notFound()

  // BR-16-03: 本文更新後に embedding が未再生成なら警告
  const needsRebuild =
    !report.embeddings_updated_at || report.embeddings_updated_at < report.updated_at

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{report.title}</h1>
          <p className="text-sm text-muted-foreground">
            {report.persons?.name ?? '—'} ／ {formatMonth(report.report_month)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <RebuildEmbeddingsButton reportId={report.id} />
          <Button asChild size="sm">
            <Link href={`/admin/reports/${report.id}/edit`}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              編集
            </Link>
          </Button>
        </div>
      </div>

      {needsRebuild && (
        <Alert variant="warning">
          <TriangleAlert className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Embedding 再生成が必要です</AlertTitle>
          <AlertDescription>
            本文が更新されてから AI 参照データ（Embedding）が再生成されていません。
            「Embedding 再生成」を実行すると最新の内容が Bot の回答に反映されます
          </AlertDescription>
        </Alert>
      )}

      {report.error_message && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>処理エラー</AlertTitle>
          <AlertDescription>{report.error_message}</AlertDescription>
        </Alert>
      )}

      <dl className="flex flex-wrap gap-x-8 gap-y-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">状態</dt>
          <dd>
            <StatusBadge status={report.status} />
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">AI参照</dt>
          <dd>
            {report.is_ai_reference ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                対象
              </span>
            ) : (
              <span className="text-muted-foreground">対象外</span>
            )}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">最終 Embedding</dt>
          <dd className="tabular-nums">
            {report.embeddings_updated_at ? formatDateTime(report.embeddings_updated_at) : '未生成'}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">更新日時</dt>
          <dd className="tabular-nums">{formatDateTime(report.updated_at)}</dd>
        </div>
        {report.generated_by_ai && (
          <div className="flex items-center gap-2">
            <dd className="inline-flex items-center gap-1 text-muted-foreground">
              <Bot className="h-3.5 w-3.5" aria-hidden="true" />
              AI が自動生成
            </dd>
          </div>
        )}
      </dl>

      <Card>
        <CardContent className="pt-6">
          {report.body_markdown?.trim() ? (
            <MarkdownContent markdown={report.body_markdown} />
          ) : (
            <p className="text-sm text-muted-foreground">本文がまだありません</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
