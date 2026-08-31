/** @file
 * 機能: レポート一覧のフィルタ（生徒 / 対象月 / 状態）。URL クエリと同期し SSR で絞り込む
 * 備考: H-13 月入力はローカル state で即時反映し、URL 同期はデバウンスする。
 *   以前は value を props（＝サーバー往復後の値）に直結していたため、
 *   年→月と打つ途中でサーバー応答が戻るたびに入力値が巻き戻ってちらついていた
 * @implements FR-16（SCR-07）
 */
'use client'

import { useEffect, useRef, useState } from 'react'
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
}

/**
 * フィルタに出す状態。'sent'（送信済み）は除く。この状態を書き込むのは生徒チャンネルへの
 * Slack 送信（FR-08 / AC-08-02）だけで、その処理が未実装のため該当レポートが存在せず、
 * 選ぶと常に 0 件になる。FR-08 実装時に REPORT_STATUSES へ戻す
 */
const FILTER_STATUSES = REPORT_STATUSES.filter((s) => s !== 'sent')

/** 月入力の URL 同期を遅らせる時間（ms）。打鍵ごとにサーバー往復させない */
const MONTH_DEBOUNCE_MS = 300

export function ReportsFilter({
  persons,
  value,
}: {
  persons: { id: string; name: string }[]
  value: ReportsFilterValue
}) {
  const router = useRouter()
  const [month, setMonth] = useState(value.month ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 「クリア」や戻る操作で URL 側が変わったときはローカル state を追従させる
  useEffect(() => {
    setMonth(value.month ?? '')
  }, [value.month])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function apply(next: ReportsFilterValue) {
    const params = new URLSearchParams()
    if (next.personId) params.set('person', next.personId)
    if (next.month) params.set('month', next.month)
    if (next.status) params.set('status', next.status)
    const qs = params.toString()
    router.replace(qs ? `/admin/reports?${qs}` : '/admin/reports')
  }

  function onMonthChange(raw: string) {
    setMonth(raw)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      apply({ ...value, month: raw || undefined })
    }, MONTH_DEBOUNCE_MS)
  }

  function clearAll() {
    if (timer.current) clearTimeout(timer.current)
    setMonth('')
    apply({})
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
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
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
            {FILTER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {hasFilter && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="h-4 w-4" aria-hidden="true" />
          クリア
        </Button>
      )}
    </div>
  )
}
