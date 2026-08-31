/** @file
 * 機能: Embedding 手動再生成ボタン（確認ダイアログ付き。SCR-09）
 * 備考: embedding API 呼び出しでコストが発生するため確認ダイアログを必須とする。
 *   実行権限は Server Action 側で requireAdmin により検証される（BR-16-02）
 * @implements FR-16, AC-16-02, BR-16-02
 */
'use client'

import { useActionState, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { rebuildEmbeddingsAction } from '../actions/reportActions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'

export function RebuildEmbeddingsButton({ reportId }: { reportId: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(rebuildEmbeddingsAction, undefined)

  useEffect(() => {
    if (!state) return
    if (state.ok) {
      toast({ description: 'Embedding を再生成しました' })
      setOpen(false)
    } else {
      toast({ variant: 'destructive', description: state.error })
    }
  }, [state])

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Embedding 再生成
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Embedding を再生成しますか？</DialogTitle>
          <DialogDescription>
            本文からチャンクを作り直し、embedding API を呼び出します（API
            利用コストが発生します）。この操作は管理者のみ実行できます。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <form action={formAction}>
            <input type="hidden" name="id" value={reportId} />
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending ? '再生成中...' : '再生成する'}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
