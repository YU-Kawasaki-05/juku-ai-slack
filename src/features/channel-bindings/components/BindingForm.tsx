/** @file
 * 機能: チャンネル紐付け 新規作成フォーム（生徒・既定レポートを選択）
 * 備考: H-8 全フィールドの fieldErrors 描画 + maxLength、H-9 二重送信防止、
 *   H-11 default_report_id の選択 UI。既定レポートは選択中の生徒の「承認済み/送信済み」に絞る
 * セキュリティ: 生徒を間違えると、そのチャンネルの質問に別生徒の学習履歴とレポートで
 *   回答してしまう（BR-07-01 の信頼の基点）。EP-07〜09 を staff に開いた代わりに、
 *   確定前に「どのチャンネルを誰に紐付けるか」を生徒名つきで確認させる
 * @implements FR-15, AC-15-01, AC-15-03
 */
'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2 } from 'lucide-react'
import { createBindingAction } from '../actions/bindingActions'
import { NO_DEFAULT_REPORT } from '../schemas/bindingSchema'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import type { ActionResult } from '@shared/types/action'
import { FieldError } from '@/components/admin/FieldError'

/** 既定レポートの選択肢（承認済み/送信済みのみを呼び出し元が渡す） */
export interface BindingReportOption {
  id: string
  personId: string
  label: string
}

export function BindingForm({
  persons,
  reports = [],
}: {
  persons: { id: string; name: string }[]
  reports?: BindingReportOption[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    createBindingAction,
    undefined,
  )
  const [personId, setPersonId] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  /** 確認ダイアログを通したかの印。state ではなく ref なのは requestSubmit と同じターンで読むため */
  const confirmedRef = useRef(false)
  const [confirming, setConfirming] = useState<{ channel: string; personName: string } | null>(null)

  useEffect(() => {
    if (state?.ok) {
      toast({ description: 'チャンネルを紐付けました' })
      router.push('/admin/channels')
    }
  }, [state, router])

  const err = state && !state.ok ? state : undefined
  const personReports = personId ? reports.filter((r) => r.personId === personId) : []
  const selectedPerson = persons.find((p) => p.id === personId)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (confirmedRef.current) {
      confirmedRef.current = false
      return
    }
    // 生徒が未選択だと確認文が「誰に紐付けるか」を言えない。そのままサーバー側の検証に任せる
    if (!selectedPerson) return
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const channelName = String(data.get('slackChannelName') ?? '').trim()
    const channelId = String(data.get('slackChannelId') ?? '').trim()
    setConfirming({
      channel: channelName ? `#${channelName}` : channelId,
      personName: selectedPerson.name,
    })
  }

  function submitConfirmed() {
    confirmedRef.current = true
    setConfirming(null)
    formRef.current?.requestSubmit()
  }

  return (
    <Card className="max-w-xl">
      <CardContent className="pt-6">
        <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="space-y-5">
          {err && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{err.error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="slackChannelId">
              SlackチャンネルID{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="slackChannelId"
              name="slackChannelId"
              placeholder="C0XXXXXXX"
              required
              maxLength={50}
              aria-invalid={err?.fieldErrors?.slackChannelId ? true : undefined}
              aria-describedby={
                err?.fieldErrors?.slackChannelId
                  ? 'slackChannelId-error slackChannelId-help'
                  : 'slackChannelId-help'
              }
            />
            <FieldError id="slackChannelId-error" message={err?.fieldErrors?.slackChannelId} />
            <p id="slackChannelId-help" className="text-xs text-muted-foreground">
              Slack のチャンネル詳細（チャンネル名クリック）の最下部からコピーできます
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="slackTeamId">
              ワークスペースID{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="slackTeamId"
              name="slackTeamId"
              placeholder="T0XXXXXXX"
              required
              maxLength={50}
              aria-invalid={err?.fieldErrors?.slackTeamId ? true : undefined}
              aria-describedby={err?.fieldErrors?.slackTeamId ? 'slackTeamId-error' : undefined}
            />
            <FieldError id="slackTeamId-error" message={err?.fieldErrors?.slackTeamId} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slackChannelName">チャンネル名（任意）</Label>
            <Input
              id="slackChannelName"
              name="slackChannelName"
              placeholder="study-taro"
              maxLength={200}
              aria-invalid={err?.fieldErrors?.slackChannelName ? true : undefined}
              aria-describedby={
                err?.fieldErrors?.slackChannelName
                  ? 'slackChannelName-error slackChannelName-help'
                  : 'slackChannelName-help'
              }
            />
            <FieldError id="slackChannelName-error" message={err?.fieldErrors?.slackChannelName} />
            <p id="slackChannelName-help" className="text-xs text-muted-foreground">
              一覧での表示用です。Bot の動作にはチャンネルIDが使われます
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="personId">
              生徒{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <Select name="personId" required value={personId} onValueChange={setPersonId}>
              <SelectTrigger
                id="personId"
                aria-required="true"
                aria-invalid={err?.fieldErrors?.personId ? true : undefined}
                aria-describedby={err?.fieldErrors?.personId ? 'personId-error' : undefined}
              >
                <SelectValue placeholder="生徒を選択" />
              </SelectTrigger>
              <SelectContent>
                {persons.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="personId-error" message={err?.fieldErrors?.personId} />
            {persons.length === 0 && (
              <p className="text-xs text-muted-foreground">
                生徒が未登録です。先に
                <Link href="/admin/persons/new" className="text-primary underline underline-offset-4">
                  生徒を登録
                </Link>
                してください
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="defaultReportId">既定レポート（任意）</Label>
            <Select name="defaultReportId" defaultValue={NO_DEFAULT_REPORT} disabled={!personId}>
              <SelectTrigger
                id="defaultReportId"
                aria-describedby="defaultReportId-help"
                aria-invalid={err?.fieldErrors?.defaultReportId ? true : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEFAULT_REPORT}>指定しない</SelectItem>
                {personReports.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="defaultReportId-error" message={err?.fieldErrors?.defaultReportId} />
            <p id="defaultReportId-help" className="text-xs text-muted-foreground">
              {!personId
                ? '先に生徒を選択してください'
                : personReports.length === 0
                  ? 'この生徒には承認済みのレポートがまだありません'
                  : 'Bot がこのチャンネルの会話で優先的に参照するレポートです'}
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            <span aria-hidden="true">*</span> は必須項目です
          </p>

          <div className="flex gap-2 pt-1">
            {/* H-9: 成功後も無効のままにして、遷移待ちの間の二重送信を防ぐ */}
            <Button type="submit" disabled={pending || state?.ok}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending ? '保存中...' : '紐付ける'}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/admin/channels">キャンセル</Link>
            </Button>
          </div>
        </form>

        <Dialog
          open={confirming !== null}
          onOpenChange={(next) => !next && setConfirming(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>この生徒に紐付けますか？</DialogTitle>
              <DialogDescription>
                <strong className="font-semibold text-foreground">{confirming?.channel}</strong> を{' '}
                <strong className="font-semibold text-foreground">{confirming?.personName}</strong>{' '}
                さんに紐付けます。このチャンネルでの質問には、この生徒の学習履歴とレポートが使われます。
                生徒を間違えると、別の生徒の情報で回答してしまいます。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
                キャンセル
              </Button>
              <Button type="button" onClick={submitConfirmed}>
                紐付けを確定する
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
