/** @file
 * 機能: 「先月分を今すぐ作成して送る」ボタン（確認ダイアログ付き。管理者のみ表示。SCR-07）
 * 備考: LLM の利用費とメール送信を伴うため確認を必須とする。結果は 5 秒で消えるトーストではなく
 *   ダイアログ内に残す（件数やメール結果は読み返したい）。実行権限は Server Action 側の requireAdmin が検証する
 * @implements FR-08
 */
'use client'

import { useActionState, useState } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { generateMonthlyReportsAction } from '../actions/monthlyReportActions'
import { Alert, AlertDescription } from '@/components/ui/alert'
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

export function GenerateMonthlyReportsButton({ monthLabel }: { monthLabel: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(generateMonthlyReportsAction, undefined)

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Mail className="h-4 w-4" aria-hidden="true" />
          先月分を今すぐ作成して送る
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{monthLabel}分の月次レポートを作成して送りますか？</DialogTitle>
          <DialogDescription>
            生徒ごとの会話から AI がレポートの下書きを作り、設定されたメールアドレスへ添付ファイルで送ります
            （LLM の利用費がかかります）。メールは 1 か月に 1 回だけで、送信済みの月は再送されません。
            作りきれなかった分は、もう一度押すと続きから作ります。
          </DialogDescription>
        </DialogHeader>
        {state && !pending && (
          <Alert variant={state.ok ? 'default' : 'destructive'}>
            <AlertDescription className="whitespace-pre-line">
              {state.ok ? state.data?.message : state.error}
            </AlertDescription>
          </Alert>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            閉じる
          </Button>
          <form action={formAction}>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending ? '作成中...（数分かかることがあります）' : '作成して送る'}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
