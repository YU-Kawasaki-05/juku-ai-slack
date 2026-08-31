/** @file
 * 機能: レポート新規作成（SCR-08 の新規モード）
 * @implements FR-16, AC-16-01
 */
import type { Metadata } from 'next'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getPersons } from '@features/persons'
import { createReportAction } from '@features/reports'
import { ReportForm } from '@features/reports/components/ReportForm'

export const metadata: Metadata = { title: '新規レポート' }

export default async function NewReportPage() {
  const persons = await getPersons(createServerClient())

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">新規レポート</h1>
        <p className="text-sm text-muted-foreground">
          生徒の月次学習レポートを Markdown で作成します
        </p>
      </div>
      <ReportForm
        action={createReportAction}
        persons={persons.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  )
}
