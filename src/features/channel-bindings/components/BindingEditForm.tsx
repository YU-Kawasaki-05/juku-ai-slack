/** @file
 * 機能: チャンネル紐付けの編集フォーム（channel名/status のみ。channel_id は変更不可）
 * @implements FR-15, AC-15-02, BR-15-01
 */
'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { updateBindingAction } from '../actions/bindingActions'
import type { BindingWithPerson } from '../lib/getBindings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActionResult } from '@shared/types/action'

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export function BindingEditForm({ binding }: { binding: BindingWithPerson }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    updateBindingAction,
    undefined,
  )

  useEffect(() => {
    if (state?.ok) router.push('/admin/channels')
  }, [state, router])

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <input type="hidden" name="id" value={binding.id} />

      <div className="space-y-2">
        <Label>チャンネルID（変更不可）</Label>
        <p className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
          {binding.slack_channel_id}
        </p>
      </div>

      <div className="space-y-2">
        <Label>生徒</Label>
        <p className="px-1 text-sm">
          {binding.persons?.name ?? binding.person_name_snapshot ?? '-'}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="slackChannelName">チャンネル名（表示用）</Label>
        <Input
          id="slackChannelName"
          name="slackChannelName"
          defaultValue={binding.slack_channel_name ?? ''}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">ステータス（inactive で Bot 反応停止）</Label>
        <select id="status" name="status" defaultValue={binding.status} className={selectClass}>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
        </select>
      </div>

      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? '保存中...' : '保存'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/admin/channels')}>
          キャンセル
        </Button>
      </div>
    </form>
  )
}
