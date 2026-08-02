/** @file
 * 機能: 管理画面のエラーバウンダリ（H-5）。DB 障害などで Server Component が throw したとき、
 *   Next.js 既定の英語エラー画面ではなく日本語の復旧導線を出す
 * 備考: error.tsx は Client Component 必須。digest はサーバーログと突き合わせるための ID
 * @implements FR-13
 */
'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[admin] unhandled error', error)
  }, [error])

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-lg border border-dashed py-16 text-center"
    >
      <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">画面の表示中に問題が発生しました</h1>
        <p className="text-sm text-muted-foreground">
          一時的な通信・データベースの不調の可能性があります。再試行しても直らない場合は、
          下のエラーIDを添えて管理者にご連絡ください
        </p>
      </div>
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          エラーID:{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{error.digest}</code>
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => reset()}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          再試行
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin">ダッシュボードへ戻る</Link>
        </Button>
      </div>
    </div>
  )
}
