/** @file
 * 機能: エラー一覧のフィルタ（severity / 対応状況）。URL クエリと同期し SSR で絞り込む
 * 備考: severity 既定値はエラー・警告（info 除外, BR-17-02）。「すべて」で info も表示できる
 * @implements FR-17, BR-17-02（SCR-11）
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

export interface ErrorsFilterValue {
  /** 'error' | 'warning' | 'info' | 'all'。undefined = エラー・警告（既定） */
  severity?: string
  /** 'true' | 'false'。undefined = すべて */
  resolved?: string
}

export function ErrorsFilter({ value }: { value: ErrorsFilterValue }) {
  const router = useRouter()

  function apply(next: ErrorsFilterValue) {
    const params = new URLSearchParams()
    if (next.severity) params.set('severity', next.severity)
    if (next.resolved) params.set('resolved', next.resolved)
    const qs = params.toString()
    router.replace(qs ? `/admin/errors?${qs}` : '/admin/errors')
  }

  const hasFilter = Boolean(value.severity || value.resolved)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="filter-severity" className="text-xs text-muted-foreground">
          深刻度
        </Label>
        <Select
          value={value.severity ?? 'default'}
          onValueChange={(v) => apply({ ...value, severity: v === 'default' ? undefined : v })}
        >
          <SelectTrigger id="filter-severity" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">エラー・警告（既定）</SelectItem>
            <SelectItem value="error">エラーのみ</SelectItem>
            <SelectItem value="warning">警告のみ</SelectItem>
            <SelectItem value="info">情報のみ</SelectItem>
            <SelectItem value="all">すべて</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-resolved" className="text-xs text-muted-foreground">
          対応状況
        </Label>
        <Select
          value={value.resolved ?? 'all'}
          onValueChange={(v) => apply({ ...value, resolved: v === 'all' ? undefined : v })}
        >
          <SelectTrigger id="filter-resolved" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            <SelectItem value="false">未対応のみ</SelectItem>
            <SelectItem value="true">対応済みのみ</SelectItem>
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
