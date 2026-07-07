/** @file
 * 機能: 有効/無効の共通セレクト（FormData の status として送信される）
 * @implements FR-14, FR-15（SCR-04/06 のステータス変更）
 */
'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function StatusSelect({
  id,
  name = 'status',
  defaultValue = 'active',
  'aria-describedby': describedBy,
}: {
  id: string
  name?: string
  defaultValue?: string
  'aria-describedby'?: string
}) {
  return (
    <Select name={name} defaultValue={defaultValue}>
      <SelectTrigger id={id} aria-describedby={describedBy}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">有効</SelectItem>
        <SelectItem value="inactive">無効</SelectItem>
      </SelectContent>
    </Select>
  )
}
