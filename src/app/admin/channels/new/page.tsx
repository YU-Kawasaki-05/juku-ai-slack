/** @file
 * 機能: チャンネル紐付け 新規作成（SCR-06）
 * @implements FR-15, AC-15-01
 */
import type { Metadata } from 'next'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getPersons } from '@features/persons'
import { getReports } from '@features/reports'
import { BindingForm } from '@features/channel-bindings/components/BindingForm'
import { formatMonth } from '@/components/admin/formatDate'
import { ChannelAdminOnlyNotice, hasChannelAdminAccess } from '../adminOnly'

export const metadata: Metadata = { title: '新規チャンネル紐付け' }

/**
 * 既定レポートの候補は「承認済み」と「送信済み」。
 * 送信済みは承認後の状態であり、match_report_chunks（migration 021）も
 * status IN ('approved','sent') を AI 参照可能とみなすためここでも同じ集合にする
 */
const DEFAULT_REPORT_STATUSES = ['approved', 'sent'] as const

export default async function NewBindingPage() {
  // EP-07: admin 限定。生徒・レポートの一覧を読む前に弾く
  if (!(await hasChannelAdminAccess())) return <ChannelAdminOnlyNotice />

  const db = createServerClient()
  const [persons, approved, sent] = await Promise.all([
    getPersons(db),
    getReports(db, { status: DEFAULT_REPORT_STATUSES[0] }),
    getReports(db, { status: DEFAULT_REPORT_STATUSES[1] }),
  ])

  const reports = [...approved, ...sent]
    .sort((a, b) => b.report_month.localeCompare(a.report_month))
    .map((r) => ({
      id: r.id,
      personId: r.person_id,
      label: `${formatMonth(r.report_month)} ${r.title}`,
    }))

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">新規チャンネル紐付け</h1>
        <p className="text-sm text-muted-foreground">
          Slack チャンネルと生徒を対応付けて、Bot が反応できるようにします
        </p>
      </div>
      <BindingForm
        persons={persons.map((p) => ({ id: p.id, name: p.name }))}
        reports={reports}
      />
    </div>
  )
}
