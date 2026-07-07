/** @file
 * 機能: チャンネル紐付けの編集フォーム（channel名/status のみ。channel_id は変更不可）
 * @implements FR-15, AC-15-02, BR-15-01
 */
'use client'

import { useActionState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2 } from 'lucide-react'
import { updateBindingAction } from '../actions/bindingActions'
import type { BindingWithPerson } from '../lib/getBindings'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import { StatusSelect } from '@/components/admin/StatusSelect'
import type { ActionResult } from '@shared/types/action'

export function BindingEditForm({ binding }: { binding: BindingWithPerson }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    updateBindingAction,
    undefined,
  )

  useEffect(() => {
    if (state?.ok) {
      toast({ description: '紐付けを保存しました' })
      router.push('/admin/channels')
    }
  }, [state, router])

  return (
    <Card className="max-w-xl">
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="id" value={binding.id} />

          {state && !state.ok && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <dl className="space-y-3 rounded-md border bg-muted/40 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-muted-foreground">チャンネルID</dt>
              <dd>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {binding.slack_channel_id}
                </code>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-muted-foreground">生徒</dt>
              <dd className="font-medium">
                {binding.persons?.name ?? binding.person_name_snapshot ?? '—'}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            チャンネルIDと生徒は変更できません。変更する場合は紐付けを作り直してください
          </p>

          <div className="space-y-2">
            <Label htmlFor="slackChannelName">チャンネル名（表示用）</Label>
            <Input
              id="slackChannelName"
              name="slackChannelName"
              defaultValue={binding.slack_channel_name ?? ''}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">ステータス</Label>
            <StatusSelect
              id="status"
              defaultValue={binding.status}
              aria-describedby="status-help"
            />
            <p id="status-help" className="text-xs text-muted-foreground">
              無効にすると、このチャンネルでは Bot が反応しなくなります
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending ? '保存中...' : '保存'}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/admin/channels">キャンセル</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
