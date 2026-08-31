/** @file
 * 機能: 滞留ジョブの回収 + 古い記録の掃除を手動実行するボタン
 * 備考: DEC-13 により定期実行（Cron）は使わない。一覧表示時の自動実行に加えて手動でも叩けるようにする
 * @implements F-4, A-1, A-14
 */
'use client'

import { useActionState, useEffect } from 'react'
import { Eraser, Loader2 } from 'lucide-react'
import { sweepJobsAction } from '../actions/jobActions'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'

export function SweepJobsButton() {
  const [state, formAction, pending] = useActionState(sweepJobsAction, undefined)

  useEffect(() => {
    if (!state) return
    if (state.ok) {
      toast({ description: state.data?.message ?? 'スイープを実行しました' })
    } else {
      toast({ variant: 'destructive', description: state.error })
    }
  }, [state])

  return (
    <form action={formAction}>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Eraser className="h-4 w-4" aria-hidden="true" />
        )}
        {pending ? '実行中...' : 'スイープ実行'}
      </Button>
    </form>
  )
}
