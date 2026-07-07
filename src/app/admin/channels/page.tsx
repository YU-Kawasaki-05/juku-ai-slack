/** @file
 * 機能: チャンネル紐付け一覧（SCR-05）
 * @implements FR-15
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { Link2, Plus } from 'lucide-react'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getBindings } from '@features/channel-bindings'
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
import { formatDate } from '@/components/admin/formatDate'

export const metadata: Metadata = { title: 'チャンネル紐付け' }

export default async function ChannelsPage() {
  const bindings = await getBindings(createServerClient())

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">チャンネル紐付け</h1>
          <p className="text-sm text-muted-foreground">
            Slack チャンネルと生徒の対応付け。Bot はここで有効なチャンネルにだけ反応します（全{' '}
            {bindings.length} 件）
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/channels/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            新規紐付け
          </Link>
        </Button>
      </div>

      {bindings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Link2 className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">紐付けがまだありません</p>
            <p className="text-sm text-muted-foreground">
              チャンネルと生徒を紐付けると、そのチャンネルで Bot が質問に回答します
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/channels/new">チャンネルを紐付ける</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>チャンネル</TableHead>
                <TableHead>チャンネルID</TableHead>
                <TableHead>生徒</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead>登録日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link
                      href={`/admin/channels/${b.id}`}
                      className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {b.slack_channel_name ? `#${b.slack_channel_name}` : '（名称未設定）'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {b.slack_channel_id}
                    </code>
                  </TableCell>
                  <TableCell>{b.persons?.name ?? b.person_name_snapshot ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={b.status} />
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatDate(b.created_at)}
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
