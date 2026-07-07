/** @file
 * 機能: エラー対応メモの編集フォーム（SCR-12）
 * @implements FR-17, AC-17-03
 */
'use client'

import { useActionState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { updateErrorNotesAction } from '../actions/errorActions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'

export function ErrorNotesForm({ errorId, notes }: { errorId: string; notes: string | null }) {
  const [state, formAction, pending] = useActionState(updateErrorNotesAction, undefined)

  useEffect(() => {
    if (!state) return
    if (state.ok) {
      toast({ description: 'メモを保存しました' })
    } else {
      toast({ variant: 'destructive', description: state.error })
    }
  }, [state])

  const err = state && !state.ok ? state : undefined

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={errorId} />
      <div className="space-y-2">
        <Label htmlFor="notes">対応メモ</Label>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={notes ?? ''}
          rows={4}
          maxLength={2000}
          placeholder="例: Slack の一時障害。再発なし"
          aria-invalid={err?.fieldErrors?.notes ? true : undefined}
          aria-describedby={err?.fieldErrors?.notes ? 'notes-error' : undefined}
        />
        {err?.fieldErrors?.notes && (
          <p id="notes-error" className="text-sm text-destructive">
            {err.fieldErrors.notes}
          </p>
        )}
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {pending ? '保存中...' : 'メモを保存'}
      </Button>
    </form>
  )
}
