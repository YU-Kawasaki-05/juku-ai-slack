/** @file
 * 機能: AI 応答の停止／再開ボタン（確認ダイアログ + 理由入力。DEC-15）
 * 備考: 全生徒に影響する不可逆度の高い操作のため確認ダイアログを必須とする。
 *   実行権限は Server Action 側の requireAdmin で検証される（staff が押すとエラー文言が返る）
 * @implements DEC-15, FR-18
 */
'use client'

import { useActionState, useEffect, useState } from 'react'
import { Loader2, PlayCircle, StopCircle } from 'lucide-react'
import { toggleAiResponsesAction } from '../actions/killSwitchActions'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'

export function KillSwitchToggle({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(toggleAiResponsesAction, undefined)

  useEffect(() => {
    if (!state) return
    if (state.ok) {
      const stopped = state.data?.enabled === false
      toast({
        description: stopped
          ? state.data?.notified
            ? 'AI応答を停止し、#alerts に通知しました'
            : 'AI応答を停止しました（#alerts への通知はできませんでした）'
          : state.data?.notified
            ? 'AI応答を再開し、#alerts に通知しました'
            : 'AI応答を再開しました（#alerts への通知はできませんでした）',
      })
      setOpen(false)
    } else {
      toast({ variant: 'destructive', description: state.error })
    }
  }, [state])

  const next = !enabled

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant={enabled ? 'destructive' : 'default'} size="sm">
          {enabled ? (
            <StopCircle className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
          )}
          {enabled ? 'AI応答を停止' : 'AI応答を再開'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{enabled ? 'AI応答を停止しますか？' : 'AI応答を再開しますか？'}</DialogTitle>
          <DialogDescription>
            {enabled
              ? '停止中は全生徒への AI 回答が止まり、質問には「メンテナンス中」の定型文だけを返します。この操作は管理者のみ実行でき、#alerts に通知されます。'
              : '再開すると全生徒への AI 回答が通常どおり行われます。この操作は管理者のみ実行でき、#alerts に通知されます。'}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="enabled" value={String(next)} />
          <div className="space-y-2">
            <Label htmlFor="kill-switch-reason">理由（#alerts と管理画面に表示されます）</Label>
            <Textarea
              id="kill-switch-reason"
              name="reason"
              maxLength={500}
              rows={3}
              placeholder={enabled ? '例: LLM プロバイダ障害のため一時停止' : '例: 障害復旧を確認'}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              キャンセル
            </Button>
            <Button type="submit" variant={enabled ? 'destructive' : 'default'} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending ? '切り替え中...' : enabled ? '停止する' : '再開する'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
