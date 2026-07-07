/** @file
 * 機能: 会話ログ一覧のフィルタ（生徒 / 期間）。URL クエリと同期し SSR で絞り込む
 * @implements FR-19（SCR-13）
 */
'use client'

import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CONVERSATION_RANGES } from '../lib/getConversations'

export interface ConversationsFilterValue {
  personId?: string
  days?: number
}

export function ConversationsFilter({
  persons,
  value,
}: {
  persons: { id: string; name: string }[]
  value: ConversationsFilterValue
}) {
  const router = useRouter()

  function apply(next: ConversationsFilterValue) {
    const params = new URLSearchParams()
    if (next.personId) params.set('person', next.personId)
    if (next.days) params.set('range', String(next.days))
    const qs = params.toString()
    router.replace(qs ? `/admin/conversations?${qs}` : '/admin/conversations')
  }

  const hasFilter = Boolean(value.personId || value.days)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="filter-person" className="text-xs text-muted-foreground">
          生徒
        </Label>
        <Select
          value={value.personId ?? 'all'}
          onValueChange={(v) => apply({ ...value, personId: v === 'all' ? undefined : v })}
        >
          <SelectTrigger id="filter-person" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべての生徒</SelectItem>
            {persons.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-range" className="text-xs text-muted-foreground">
          期間
        </Label>
        <Select
          value={value.days ? String(value.days) : 'all'}
          onValueChange={(v) => apply({ ...value, days: v === 'all' ? undefined : Number(v) })}
        >
          <SelectTrigger id="filter-range" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全期間</SelectItem>
            {CONVERSATION_RANGES.map((d) => (
              <SelectItem key={d} value={String(d)}>
                直近{d}日
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {hasFilter && (
        <Button variant="ghost" size="sm" onClick={() => apply({})}>
          <X className="h-4 w-4" aria-hidden="true" />
          クリア
        </Button>
      )}
    </div>
  )
}
