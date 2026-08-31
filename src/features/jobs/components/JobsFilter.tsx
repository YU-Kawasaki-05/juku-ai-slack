/** @file
 * 機能: ジョブ一覧の status フィルタ（URL クエリと同期し SSR で絞り込む）
 * 備考: 既定は「積み残し」（pending/processing/failed）。completed は明示選択したときだけ出す
 * @implements FR-04, F-4
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

export function JobsFilter({ value }: { value?: string }) {
  const router = useRouter()

  function apply(next: string | undefined) {
    router.replace(next ? `/admin/jobs?status=${next}` : '/admin/jobs')
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="filter-job-status" className="text-xs text-muted-foreground">
          状態
        </Label>
        <Select
          value={value ?? 'default'}
          onValueChange={(v) => apply(v === 'default' ? undefined : v)}
        >
          <SelectTrigger id="filter-job-status" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">積み残し（待機・処理中・失敗）</SelectItem>
            <SelectItem value="pending">待機中のみ</SelectItem>
            <SelectItem value="processing">処理中のみ</SelectItem>
            <SelectItem value="failed">失敗のみ</SelectItem>
            <SelectItem value="completed">完了のみ</SelectItem>
            <SelectItem value="all">すべて</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value && (
        <Button variant="ghost" size="sm" onClick={() => apply(undefined)}>
          <X className="h-4 w-4" aria-hidden="true" />
          クリア
        </Button>
      )}
    </div>
  )
}
