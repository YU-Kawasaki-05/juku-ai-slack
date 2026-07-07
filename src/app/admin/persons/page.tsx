/** @file
 * 機能: 生徒一覧（SCR-03）
 * @implements FR-14, AC-14-01
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus, Users } from 'lucide-react'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getPersons } from '@features/persons'
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

export const metadata: Metadata = { title: '生徒管理' }

export default async function PersonsPage() {
  const persons = await getPersons(createServerClient())

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">生徒管理</h1>
          <p className="text-sm text-muted-foreground">
            Bot を利用する生徒の登録と管理（全 {persons.length} 名）
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/persons/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            新規生徒
          </Link>
        </Button>
      </div>

      {persons.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Users className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">生徒がまだ登録されていません</p>
            <p className="text-sm text-muted-foreground">
              生徒を登録すると、Slack チャンネルとの紐付けができるようになります
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/persons/new">生徒を登録する</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>名前</TableHead>
                <TableHead>学年</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead>登録日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {persons.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/admin/persons/${p.id}`}
                      className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {p.name}
                    </Link>
                    {p.display_name && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        （{p.display_name}）
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.grade ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatDate(p.created_at)}
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
