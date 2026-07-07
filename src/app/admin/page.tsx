/** @file
 * 機能: ダッシュボード（SCR-02）。サマリー4カード + 最近のエラー
 * 備考: DEC-15 の kill_switch 状態表示は kill_switch 自体が未実装（バックエンド領域）のため未対応
 * @implements FR-18
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  CircleDollarSign,
  MessageCircleQuestion,
  Users,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createServerClient } from '@/shared/lib/supabase/serverClient'
import { getUsageSummary } from '@features/usage-logs'
import { getErrorLogs, countUnresolvedErrors } from '@features/errors'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { formatDateTime } from '@/components/admin/formatDate'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'ダッシュボード' }

export default async function AdminDashboardPage() {
  const db = createServerClient()

  const [usage, unresolvedCount, { count: studentCount }, recentErrors] = await Promise.all([
    getUsageSummary(db),
    countUnresolvedErrors(db),
    db.from('persons').select('*', { count: 'exact', head: true }),
    getErrorLogs(db, { limit: 5 }),
  ])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">ダッシュボード</h1>
        <p className="text-sm text-muted-foreground">じゅくAI の利用状況サマリー</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              今日の質問数
            </CardTitle>
            <MessageCircleQuestion
              className="h-4 w-4 text-muted-foreground/70"
              aria-hidden="true"
            />
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-3xl font-bold tabular-nums">{usage.todayQuestionCount}</p>
            <p className="text-xs text-muted-foreground">生徒からの質問（日本時間の当日分）</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              今月のコスト
            </CardTitle>
            <CircleDollarSign className="h-4 w-4 text-muted-foreground/70" aria-hidden="true" />
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-3xl font-bold tabular-nums">${usage.monthCostUsd.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">AI API の推定利用額（USD）</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              未対応エラー
            </CardTitle>
            <AlertCircle
              className={cn(
                'h-4 w-4',
                unresolvedCount > 0 ? 'text-amber-500' : 'text-muted-foreground/70',
              )}
              aria-hidden="true"
            />
          </CardHeader>
          <CardContent className="space-y-2">
            <p
              className={cn(
                'text-3xl font-bold tabular-nums',
                unresolvedCount > 0 && 'text-amber-600 dark:text-amber-400',
              )}
            >
              {unresolvedCount}
            </p>
            <Link
              href="/admin/errors?resolved=false"
              className="inline-block text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              エラー管理を開く →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">生徒数</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground/70" aria-hidden="true" />
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-3xl font-bold tabular-nums">{studentCount ?? 0}</p>
            <Link
              href="/admin/persons"
              className="inline-block text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              生徒管理を開く →
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">最近のエラー</CardTitle>
          <Link
            href="/admin/errors"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            すべて表示
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </CardHeader>
        <CardContent>
          {recentErrors.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              エラーはありません
            </p>
          ) : (
            <ul className="divide-y">
              {recentErrors.map((log) => (
                <li
                  key={log.id}
                  className={cn(
                    'flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm',
                    log.resolved && 'opacity-60',
                  )}
                >
                  <StatusBadge status={log.severity} />
                  <Link
                    href={`/admin/errors/${log.id}`}
                    className="rounded-sm font-mono text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {log.error_code}
                  </Link>
                  <span>{log.persons?.name ?? '—'}</span>
                  <span className="ml-auto whitespace-nowrap tabular-nums text-xs text-muted-foreground">
                    {formatDateTime(log.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
