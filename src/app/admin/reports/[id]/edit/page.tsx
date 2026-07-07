/** @file
 * 機能: レポート編集（SCR-08 の編集モード。生徒・対象月は変更不可）
 * @implements FR-16, AC-16-01
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getReport, updateReportAction } from '@features/reports'
import { ReportForm } from '@features/reports/components/ReportForm'

export const metadata: Metadata = { title: 'レポート編集' }

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(createServerClient(), id)
  if (!report) notFound()

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">レポート編集</h1>
        <p className="text-sm text-muted-foreground">
          保存時に AI 参照データ（Embedding）が自動的に再生成されます
        </p>
      </div>
      <ReportForm action={updateReportAction} report={report} />
    </div>
  )
}
