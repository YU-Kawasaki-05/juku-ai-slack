/** @file
 * 機能: 生徒の作成/編集フォーム（Server Action を useActionState で駆動）
 * @implements FR-14, AC-14-02
 */
'use client'

import { useActionState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import { StatusSelect } from '@/components/admin/StatusSelect'
import { FieldError } from '@/components/admin/FieldError'
import type { ActionResult } from '@shared/types/action'
import type { Tables } from '@shared/types/db'

type PersonAction = (prev: ActionResult | undefined, fd: FormData) => Promise<ActionResult>

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
    if (state?.ok) {
      toast({ description: person ? '生徒情報を保存しました' : '生徒を登録しました' })
      router.push('/admin/persons')
    }
  }, [state, router, person])

  const err = state && !state.ok ? state : undefined

  return (
    <Card className="max-w-xl">
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-5">
          {person && <input type="hidden" name="id" value={person.id} />}

          {err && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{err.error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">
              名前{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="name"
              name="name"
              defaultValue={person?.name ?? ''}
              required
              maxLength={100}
              aria-invalid={err?.fieldErrors?.name ? true : undefined}
              aria-describedby={err?.fieldErrors?.name ? 'name-error' : undefined}
            />
            <FieldError id="name-error" message={err?.fieldErrors?.name} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">表示名（任意）</Label>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={person?.display_name ?? ''}
              maxLength={100}
              aria-invalid={err?.fieldErrors?.displayName ? true : undefined}
              aria-describedby={
                err?.fieldErrors?.displayName
                  ? 'displayName-error displayName-help'
                  : 'displayName-help'
              }
            />
            <FieldError id="displayName-error" message={err?.fieldErrors?.displayName} />
            <p id="displayName-help" className="text-xs text-muted-foreground">
              Bot が呼びかけに使う名前です（例: 太郎くん）
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="grade">学年（任意）</Label>
            <Input
              id="grade"
              name="grade"
              defaultValue={person?.grade ?? ''}
              placeholder="例: 中学3年"
              maxLength={50}
              aria-invalid={err?.fieldErrors?.grade ? true : undefined}
              aria-describedby={err?.fieldErrors?.grade ? 'grade-error' : undefined}
            />
            <FieldError id="grade-error" message={err?.fieldErrors?.grade} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">ステータス</Label>
            <StatusSelect
              id="status"
              defaultValue={person?.status ?? 'active'}
              aria-describedby="status-help"
            />
            <p id="status-help" className="text-xs text-muted-foreground">
              無効にすると Bot が応答しなくなり、集計・選択肢からも除外されます（生徒一覧には残ります）
            </p>
            <FieldError id="status-error" message={err?.fieldErrors?.status} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="guardianEmail">保護者メール（任意）</Label>
            <Input
              id="guardianEmail"
              name="guardianEmail"
              type="email"
              autoComplete="off"
              defaultValue={person?.guardian_email ?? ''}
              maxLength={255}
              aria-invalid={err?.fieldErrors?.guardianEmail ? true : undefined}
              aria-describedby={err?.fieldErrors?.guardianEmail ? 'guardianEmail-error' : undefined}
            />
            <FieldError id="guardianEmail-error" message={err?.fieldErrors?.guardianEmail} />
          </div>

          <p className="text-xs text-muted-foreground">
            <span aria-hidden="true">*</span> は必須項目です
          </p>

          <div className="flex gap-2 pt-1">
            {/* H-9: persons に UNIQUE が無いため、成功後の遷移待ちに再送信されると二重登録になる */}
            <Button type="submit" disabled={pending || state?.ok}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending ? '保存中...' : '保存'}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/admin/persons">キャンセル</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
