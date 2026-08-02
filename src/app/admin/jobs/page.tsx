/** @file
 * 機能: ジョブ管理（積み残しの可視化・スイープ・failed の再実行）
 * 備考: DEC-13 により Cron を使わないため、この画面の表示自体をスイーパの起動トリガにする
 * @implements FR-04, F-4, A-1, A-14
 */
import type { Metadata } from 'next'
import { CheckCircle2, ExternalLink, Hourglass, PlayCircle, AlertTriangle } from 'lucide-react'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { env } from '@shared/lib/env'
import type { ServerDb } from '@shared/types/db'
import { buildSlackThreadUrl } from '@features/errors'
import {
  listJobs,
  getJobQueueStats,
  resolveStatusFilter,
  formatElapsed,
  runJobMaintenance,
  JOB_STATUS_VALUES,
  type JobQueueStat,
} from '@features/jobs'
import { JobsFilter } from '@features/jobs/components/JobsFilter'
import { RetryJobButton } from '@features/jobs/components/RetryJobButton'
import { SweepJobsButton } from '@features/jobs/components/SweepJobsButton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

export const metadata: Metadata = { title: 'ジョブ管理' }

const STAT_META: Record<string, { label: string; icon: typeof Hourglass; hint: string }> = {
  pending: { label: '待機中', icon: Hourglass, hint: '登録からの最長待ち時間' },
  processing: { label: '処理中', icon: PlayCircle, hint: '実行開始からの最長経過' },
  failed: { label: '失敗', icon: AlertTriangle, hint: '最も古い失敗からの経過' },
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待機中',
  processing: '処理中',
  completed: '完了',
  failed: '失敗',
}

/**
 * DEC-13: Vercel Cron / pg_cron を使わないので、スタッフがこの画面を開いたときに
 * 滞留ジョブの回収と古い記録の掃除をベストエフォートで走らせる。
 * 失敗しても一覧は表示する（回収が遅れても手動ボタンで追いつける）。
 * 連打で毎回 DELETE が飛ばないよう、同一インスタンス内では最小間隔を空ける。
 */
const MAINTENANCE_MIN_INTERVAL_MS = 60_000
let lastMaintenanceAt = 0

async function runMaintenanceBestEffort(db: ServerDb): Promise<void> {
  const now = Date.now()
  if (now - lastMaintenanceAt < MAINTENANCE_MIN_INTERVAL_MS) return
  lastMaintenanceAt = now
  try {
    await runJobMaintenance(db)
  } catch (err) {
    console.error('[admin/jobs] job maintenance failed (ignored)', err)
  }
}

function statTile(stat: JobQueueStat, nowMs: number) {
  const meta = STAT_META[stat.status]
  return {
    key: stat.status,
    label: meta.label,
    icon: meta.icon,
    count: stat.count,
    elapsed: stat.oldestIso ? formatElapsed(stat.oldestIso, nowMs) : '—',
    hint: meta.hint,
  }
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const sp = await searchParams
  const status =
    sp.status && ([...JOB_STATUS_VALUES, 'all'] as readonly string[]).includes(sp.status)
      ? sp.status
      : undefined

  const db = createServerClient()
  await runMaintenanceBestEffort(db)

  const [stats, jobs] = await Promise.all([
    getJobQueueStats(db),
    listJobs(db, { status }),
  ])
  const nowMs = Date.now()
  const tiles = stats.map((s) => statTile(s, nowMs))
  const backlog = stats.reduce((sum, s) => sum + s.count, 0)
  const selected = resolveStatusFilter(status)
  const statusLabel = selected.length === 1 ? STATUS_LABELS[selected[0]] : undefined

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">ジョブ管理</h1>
          <p className="text-sm text-muted-foreground">
            Slack メッセージ処理ジョブの状態確認と再実行（表示中 {jobs.length} 件
            {statusLabel ? ` / ${statusLabel}のみ` : ''}）
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <SweepJobsButton />
          <p className="text-xs text-muted-foreground">
            この画面を開くと滞留ジョブの回収と古い記録の掃除を自動実行します
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.key}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
              <t.icon className="h-4 w-4 text-muted-foreground/70" aria-hidden="true" />
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-3xl font-bold tabular-nums">{t.count.toLocaleString('ja-JP')}</p>
              <p className="text-xs text-muted-foreground">
                {t.count > 0 ? `最古: ${t.elapsed}（${t.hint}）` : '滞留なし'}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <JobsFilter value={status} />

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <CheckCircle2 className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">
              {backlog === 0 && !status
                ? 'ジョブの積み残しはありません'
                : '条件に一致するジョブがありません'}
            </p>
            <p className="text-sm text-muted-foreground">
              Slack で質問を受け付けるとここにジョブが並びます
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>状態</TableHead>
                <TableHead>エラーコード</TableHead>
                <TableHead className="whitespace-nowrap">試行</TableHead>
                <TableHead>チャンネル</TableHead>
                <TableHead>スレッド</TableHead>
                <TableHead className="whitespace-nowrap">経過（登録から）</TableHead>
                <TableHead className="whitespace-nowrap">登録日時</TableHead>
                <TableHead className="whitespace-nowrap">更新日時</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const threadUrl = buildSlackThreadUrl(
                  env.SLACK_WORKSPACE_URL,
                  job.channelId,
                  job.threadTs,
                )
                return (
                  <TableRow key={job.id}>
                    <TableCell>
                      <StatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {job.errorCode ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {job.attemptCount} / {job.maxAttempts}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {job.channelName ? `#${job.channelName}` : (job.channelId ?? '—')}
                    </TableCell>
                    <TableCell>
                      {threadUrl ? (
                        <a
                          href={threadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          Slack で開く
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="sr-only">（新しいタブで開きます）</span>
                        </a>
                      ) : (
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                          {job.threadTs ?? '—'}
                        </code>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatElapsed(job.createdAt, nowMs)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatDateTime(job.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatDateTime(job.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {job.status === 'failed' ? (
                        <RetryJobButton jobId={job.id} hasResultText={job.hasResultText} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
