/** @file
 * 機能: エラー詳細（SCR-12）。対応済みトグル・メモ記入・Slack スレッドリンク
 * 備考: raw_error は MVP では表示しない（BR-17-01。マスキング処理の実装後に解禁）
 * @implements FR-17, AC-17-02, AC-17-03, BR-17-01, BR-17-03
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { env } from '@shared/lib/env'
import { getErrorLog, buildSlackThreadUrl } from '@features/errors'
import { ErrorNotesForm } from '@features/errors/components/ErrorNotesForm'
import { ResolveErrorButton } from '@features/errors/components/ResolveErrorButton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { formatDateTime } from '@/components/admin/formatDate'

export const metadata: Metadata = { title: 'エラー詳細' }

export default async function ErrorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const log = await getErrorLog(createServerClient(), id)
  if (!log) notFound()

  const threadUrl = buildSlackThreadUrl(
    env.SLACK_WORKSPACE_URL,
    log.slack_channel_id,
    log.thread_ts,
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-mono text-2xl font-bold tracking-tight">{log.error_code}</h1>
          <div className="flex items-center gap-2">
            <StatusBadge status={log.severity} />
            <StatusBadge status={log.resolved ? 'resolved' : 'unresolved'} />
            {log.retryable && (
              <span className="text-xs text-muted-foreground">リトライ可能なエラー</span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <ResolveErrorButton errorId={log.id} resolved={log.resolved} />
        </div>
      </div>

      <dl className="grid gap-x-8 gap-y-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm sm:grid-cols-2">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">発生日時</dt>
          <dd className="tabular-nums">{formatDateTime(log.created_at)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">生徒</dt>
          <dd className="font-medium">
            {log.person_id ? (
              <Link
                href={`/admin/persons/${log.person_id}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {log.persons?.name ?? '（名前不明）'}
              </Link>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">チャンネル</dt>
          <dd>
            {log.channelName && <span className="mr-2 font-medium">#{log.channelName}</span>}
            {log.slack_channel_id ? (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {log.slack_channel_id}
              </code>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Slack スレッド</dt>
          <dd>
            {threadUrl ? (
              <a
                href={threadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
              >
                Slack で開く
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">（新しいタブで開きます）</span>
              </a>
            ) : log.thread_ts ? (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {log.thread_ts}
              </code>
            ) : (
              '—'
            )}
          </dd>
        </div>
        {log.provider && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">プロバイダ</dt>
            <dd>{log.provider}</dd>
          </div>
        )}
      </dl>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ユーザーへ返した文言</CardTitle>
        </CardHeader>
        <CardContent>
          {log.user_facing_message ? (
            <blockquote className="border-l-2 pl-4 text-sm leading-7">
              {log.user_facing_message}
            </blockquote>
          ) : (
            <p className="text-sm text-muted-foreground">
              返信なし（サイレント処理されたエラーです）
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">内部エラー詳細</CardTitle>
        </CardHeader>
        <CardContent>
          {log.internal_message ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-xs leading-5">
              {log.internal_message}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">内部詳細はありません</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <ErrorNotesForm errorId={log.id} notes={log.notes} />
        </CardContent>
      </Card>
    </div>
  )
}
