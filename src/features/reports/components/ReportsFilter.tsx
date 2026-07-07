/** @file
 * 機能: レポート一覧のフィルタ（生徒 / 対象月 / 状態）。URL クエリと同期し SSR で絞り込む
 * @implements FR-16（SCR-07）
 */
'use client'

import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { REPORT_STATUSES } from '../schemas/reportSchema'

export interface ReportsFilterValue {
  personId?: string
  month?: string
  status?: string
}

const STATUS_LABELS: Record<string, string> = {
  ai_draft: 'AI下書き',
  draft: '下書き',
  approved: '承認済み',
  sent: '送信済み',
}

export function ReportsFilter({
  persons,
  value,
}: {
  persons: { id: string; name: string }[]
  value: ReportsFilterValue
}) {
  const router = useRouter()

  function apply(next: ReportsFilterValue) {
    const params = new URLSearchParams()
    if (next.personId) params.set('person', next.personId)
    if (next.month) params.set('month', next.month)
    if (next.status) params.set('status', next.status)
    const qs = params.toString()
    router.replace(qs ? `/admin/reports?${qs}` : '/admin/reports')
  }

  const hasFilter = Boolean(value.personId || value.month || value.status)

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
        <Label htmlFor="filter-month" className="text-xs text-muted-foreground">
          対象月
        </Label>
        <Input
          id="filter-month"
          type="month"
          className="w-40"
          value={value.month ?? ''}
          onChange={(e) => apply({ ...value, month: e.target.value || undefined })}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-status" className="text-xs text-muted-foreground">
          状態
        </Label>
        <Select
          value={value.status ?? 'all'}
          onValueChange={(v) => apply({ ...value, status: v === 'all' ? undefined : v })}
        >
          <SelectTrigger id="filter-status" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべての状態</SelectItem>
            {REPORT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s] ?? s}
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
