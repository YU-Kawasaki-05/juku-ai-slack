/** @file
 * 機能: failed ジョブの再実行ボタン（確認ダイアログ付き）
 * 備考: 再実行は Slack への投稿を伴うため確認を挟む。
 *   「既に配信済みのジョブを再実行して二重返信になる」事故は Server Action 側でも
 *   slack_messages を見てガードする（retryJob）
 * @implements F-4, A-3
 */
'use client'

import { useActionState, useEffect, useState } from 'react'
import { Loader2, RotateCw } from 'lucide-react'
import { retryJobAction } from '../actions/jobActions'
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

export function RetryJobButton({
  jobId,
  hasResultText,
}: {
  jobId: string
  hasResultText: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(retryJobAction, undefined)

  useEffect(() => {
    if (!state) return
    if (state.ok) {
      toast({ description: state.data?.message ?? '再実行しました' })
      setOpen(false)
    } else {
      toast({ variant: 'destructive', description: state.error })
    }
  }, [state])

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          再実行
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>このジョブを再実行しますか？</DialogTitle>
          <DialogDescription>
            {hasResultText
              ? '生成済みの回答が残っているため、AI を呼び直さず Slack への投稿だけをやり直します。'
              : 'AI 回答を生成し直して Slack に投稿します（API 利用コストが発生します）。'}
            {' '}
            実行前に同じスレッドへの返信済みチェックを行い、配信済みなら再実行せず完了として記録します。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <form action={formAction}>
            <input type="hidden" name="id" value={jobId} />
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending ? '実行中...' : '再実行する'}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
