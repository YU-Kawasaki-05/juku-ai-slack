/** @file
 * 機能: エラーの対応済みトグルボタン（SCR-12。可逆操作のため確認ダイアログなし）
 * @implements FR-17, AC-17-02, BR-17-03
 */
'use client'

import { useActionState, useEffect } from 'react'
import { CheckCircle2, Loader2, Undo2 } from 'lucide-react'
import { resolveErrorAction } from '../actions/errorActions'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'

export function ResolveErrorButton({ errorId, resolved }: { errorId: string; resolved: boolean }) {
  const [state, formAction, pending] = useActionState(resolveErrorAction, undefined)

  useEffect(() => {
    if (!state) return
    if (state.ok) {
      toast({ description: '対応状況を更新しました' })
    } else {
      toast({ variant: 'destructive', description: state.error })
    }
  }, [state])

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={errorId} />
      <input type="hidden" name="resolved" value={String(!resolved)} />
      <Button type="submit" variant={resolved ? 'outline' : 'default'} size="sm" disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : resolved ? (
          <Undo2 className="h-4 w-4" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        )}
        {resolved ? '未対応に戻す' : '対応済みにする'}
      </Button>
    </form>
  )
}
