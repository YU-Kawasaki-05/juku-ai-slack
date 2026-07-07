/** @file
 * 機能: チャンネル紐付け 新規作成フォーム（生徒を選択）
 * @implements FR-15, AC-15-01, AC-15-03
 */
'use client'

import { useActionState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2 } from 'lucide-react'
import { createBindingAction } from '../actions/bindingActions'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

export function BindingForm({ persons }: { persons: { id: string; name: string }[] }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    createBindingAction,
    undefined,
  )

  useEffect(() => {
    if (state?.ok) {
      toast({ description: 'チャンネルを紐付けました' })
      router.push('/admin/channels')
    }
  }, [state, router])

  return (
    <Card className="max-w-xl">
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-5">
          {state && !state.ok && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{state.error}</AlertDescription>
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
              aria-describedby="slackChannelId-help"
            />
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
            <Input id="slackTeamId" name="slackTeamId" placeholder="T0XXXXXXX" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slackChannelName">チャンネル名（任意）</Label>
            <Input
              id="slackChannelName"
              name="slackChannelName"
              placeholder="study-taro"
              aria-describedby="slackChannelName-help"
            />
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
            <Select name="personId">
              <SelectTrigger id="personId" aria-required="true">
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

          <p className="text-xs text-muted-foreground">
            <span aria-hidden="true">*</span> は必須項目です
          </p>

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending ? '保存中...' : '紐付ける'}
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
