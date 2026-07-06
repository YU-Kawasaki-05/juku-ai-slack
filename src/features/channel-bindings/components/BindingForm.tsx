/** @file
 * 機能: チャンネル紐付け 新規作成フォーム（生徒を選択）
 * @implements FR-15, AC-15-01, AC-15-03
 */
'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBindingAction } from '../actions/bindingActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActionResult } from '@shared/types/action'

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export function BindingForm({ persons }: { persons: { id: string; name: string }[] }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    createBindingAction,
    undefined,
  )

  useEffect(() => {
    if (state?.ok) router.push('/admin/channels')
  }, [state, router])

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="space-y-2">
        <Label htmlFor="slackChannelId">SlackチャンネルID</Label>
        <Input id="slackChannelId" name="slackChannelId" placeholder="C0XXXXXXX" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slackTeamId">ワークスペースID</Label>
        <Input id="slackTeamId" name="slackTeamId" placeholder="T0XXXXXXX" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slackChannelName">チャンネル名（表示用・任意）</Label>
        <Input id="slackChannelName" name="slackChannelName" placeholder="study-taro" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="personId">生徒</Label>
        <select id="personId" name="personId" defaultValue="" className={selectClass} required>
          <option value="" disabled>
            生徒を選択
          </option>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? '保存中...' : '紐付ける'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/admin/channels')}>
          キャンセル
        </Button>
      </div>
    </form>
  )
}
