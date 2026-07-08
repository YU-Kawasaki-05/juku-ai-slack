/** @file
 * 機能: 会話ログ一覧（SCR-13 / FR-19）。スレッド単位。生徒/期間/画像/モデル/エラーで絞り込み
 * @implements FR-19
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, ImageIcon, MessagesSquare } from 'lucide-react'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getPersons } from '@features/persons'
import {
  getThreads,
  getUsedModels,
  CONVERSATION_RANGES,
  type ConversationRangeDays,
} from '@features/conversation-logs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConversationsFilter } from '@features/conversation-logs/components/ConversationsFilter'
import { formatDateTime } from '@/components/admin/formatDate'

export const metadata: Metadata = { title: '会話ログ' }

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    person?: string
    range?: string
    model?: string
    image?: string
    err?: string
  }>
}) {
  const sp = await searchParams
  const personId = sp.person && /^[0-9a-f-]{36}$/i.test(sp.person) ? sp.person : undefined
  const days =
    sp.range && (CONVERSATION_RANGES as readonly number[]).includes(Number(sp.range))
      ? (Number(sp.range) as ConversationRangeDays)
      : undefined
  const hasImage = sp.image === '1' || undefined
  const hasError = sp.err === '1' || undefined

  const db = createServerClient()
  const [persons, models] = await Promise.all([getPersons(db), getUsedModels(db)])
  const model = sp.model && models.includes(sp.model) ? sp.model : undefined

  const threads = await getThreads(db, { personId, days, model, hasImage, hasError })
  const hasFilter = Boolean(personId || days || model || hasImage || hasError)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">会話ログ</h1>
        <p className="text-sm text-muted-foreground">
          生徒と Bot のスレッド単位の会話履歴（表示中 {threads.length} 件）
        </p>
      </div>

      <ConversationsFilter
        persons={persons.map((p) => ({ id: p.id, name: p.name }))}
        models={models}
        value={{ personId, days, model, hasImage, hasError }}
      />

      {threads.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <MessagesSquare className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">
              {hasFilter ? '条件に一致する会話がありません' : '会話がまだありません'}
            </p>
            <p className="text-sm text-muted-foreground">
              {hasFilter
                ? 'フィルタ条件を変更してお試しください'
                : '生徒が Slack で質問すると、ここに会話が記録されます'}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>生徒</TableHead>
                <TableHead>チャンネル</TableHead>
                <TableHead>概要</TableHead>
                <TableHead className="text-right">件数</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>最終メッセージ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {threads.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link
                      href={`/admin/conversations/${t.id}`}
                      className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {t.persons?.name ?? '—'}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.channelName ? `#${t.channelName}` : t.slack_channel_id}
                  </TableCell>
                  <TableCell
                    className="max-w-md truncate text-muted-foreground"
                    title={t.thread_summary ?? undefined}
                  >
                    {t.thread_summary ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.messageCount}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {t.hasImage && (
                        <span
                          className="inline-flex items-center gap-1 text-xs"
                          title="画像添付あり"
                        >
                          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="sr-only">画像添付あり</span>
                        </span>
                      )}
                      {t.hasError && (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                          title="エラーが発生"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="sr-only">エラーが発生</span>
                        </span>
                      )}
                      {!t.hasImage && !t.hasError && <span className="text-xs">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {t.last_message_at ? formatDateTime(t.last_message_at) : '—'}
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
