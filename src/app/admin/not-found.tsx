/** @file
 * 機能: 管理画面の 404 画面（H-5）。存在しない ID や不正な URL を開いたときに
 *   英語の既定 404 ではなく日本語の復旧導線を出す
 * @implements FR-13
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'ページが見つかりません' }

export default function AdminNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed py-16 text-center">
      <FileQuestion className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">ページが見つかりません</h1>
        <p className="text-sm text-muted-foreground">
          URL が間違っているか、対象のデータが削除された可能性があります
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link href="/admin">ダッシュボードへ戻る</Link>
      </Button>
    </div>
  )
}
