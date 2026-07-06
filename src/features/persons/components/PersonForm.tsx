/** @file
 * 機能: 生徒の作成/編集フォーム（Server Action を useActionState で駆動）
 * @implements FR-14, AC-14-02
 */
'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActionResult } from '@shared/types/action'
import type { Tables } from '@shared/types/db'

type PersonAction = (prev: ActionResult | undefined, fd: FormData) => Promise<ActionResult>

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export function PersonForm({
  action,
  person,
}: {
  action: PersonAction
  person?: Tables<'persons'>
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(action, undefined)

  useEffect(() => {
    if (state?.ok) router.push('/admin/persons')
  }, [state, router])

  const err = state && !state.ok ? state : undefined

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {person && <input type="hidden" name="id" value={person.id} />}

      <div className="space-y-2">
        <Label htmlFor="name">名前</Label>
        <Input id="name" name="name" defaultValue={person?.name ?? ''} required />
        {err?.fieldErrors?.name && <p className="text-sm text-destructive">{err.fieldErrors.name}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="displayName">表示名（任意）</Label>
        <Input id="displayName" name="displayName" defaultValue={person?.display_name ?? ''} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="grade">学年（任意）</Label>
        <Input id="grade" name="grade" defaultValue={person?.grade ?? ''} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">ステータス</Label>
        <select id="status" name="status" defaultValue={person?.status ?? 'active'} className={selectClass}>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="guardianEmail">保護者メール（任意）</Label>
        <Input
          id="guardianEmail"
          name="guardianEmail"
          type="email"
          defaultValue={person?.guardian_email ?? ''}
        />
        {err?.fieldErrors?.guardianEmail && (
          <p className="text-sm text-destructive">{err.fieldErrors.guardianEmail}</p>
        )}
      </div>

      {err && !err.fieldErrors && <p className="text-sm text-destructive">{err.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? '保存中...' : '保存'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/admin/persons')}>
          キャンセル
        </Button>
      </div>
    </form>
  )
}
