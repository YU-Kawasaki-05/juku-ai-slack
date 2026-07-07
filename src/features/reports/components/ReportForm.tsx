/** @file
 * 機能: レポートの作成/編集フォーム（Markdown エディタ + プレビュー、下書き/承認の2段保存）
 * 備考: 押した保存ボタン（name="status"）の値が FormData に入り、保存後の状態になる。
 *   生徒・対象月は作成時のみ指定可（編集では固定表示）
 * @implements FR-16, AC-16-01, BR-16-01
 */
'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { formatMonth } from '@/components/admin/formatDate'
import type { ActionResult } from '@shared/types/action'
import type { ReportWithPerson } from '../lib/getReports'
import type { ReportSaveResult } from '../actions/reportActions'
import { MarkdownContent } from './MarkdownContent'

type ReportAction = (
  prev: ActionResult<ReportSaveResult> | undefined,
  fd: FormData,
) => Promise<ActionResult<ReportSaveResult>>

export function ReportForm({
  action,
  persons,
  report,
}: {
  action: ReportAction
  /** 新規作成時のみ（生徒選択肢） */
  persons?: { id: string; name: string }[]
  /** 編集時のみ */
  report?: ReportWithPerson
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(action, undefined)
  const [body, setBody] = useState(report?.body_markdown ?? '')
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')

  useEffect(() => {
    if (state?.ok) {
      if (state.data?.embeddingWarning) {
        toast({
          variant: 'destructive',
          title: '保存しました（AI 参照データは未更新）',
          description:
            'Embedding の自動再生成に失敗しました。詳細ページから手動で再生成してください',
        })
      } else {
        toast({ description: 'レポートを保存しました' })
      }
      router.push('/admin/reports')
    }
  }, [state, router])

  const err = state && !state.ok ? state : undefined

  return (
    <Card className="max-w-3xl">
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-5">
          {report && <input type="hidden" name="id" value={report.id} />}

          {err && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{err.error}</AlertDescription>
            </Alert>
          )}

          {report?.status === 'sent' && (
            <Alert>
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                このレポートは Slack 送信済みです。保存すると状態が「下書き」または「承認済み」に変わります
              </AlertDescription>
            </Alert>
          )}

          {report ? (
            <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-md border bg-muted/40 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">生徒</dt>
                <dd className="font-medium">{report.persons?.name ?? '—'}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">対象月</dt>
                <dd className="font-medium">{formatMonth(report.report_month)}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">現在の状態</dt>
                <dd>
                  <StatusBadge status={report.status} />
                </dd>
              </div>
            </dl>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
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
                    {(persons ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reportMonth">
                  対象月{' '}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </Label>
                <Input id="reportMonth" name="reportMonth" type="month" required />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title">
              タイトル{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="title"
              name="title"
              defaultValue={report?.title ?? ''}
              placeholder="例: 2026年6月 学習レポート"
              required
              maxLength={200}
              aria-invalid={err?.fieldErrors?.title ? true : undefined}
              aria-describedby={err?.fieldErrors?.title ? 'title-error' : undefined}
            />
            {err?.fieldErrors?.title && (
              <p id="title-error" className="text-sm text-destructive">
                {err.fieldErrors.title}
              </p>
            )}
          </div>

          <div className="flex items-start gap-2">
            <input
              id="isAiReference"
              name="isAiReference"
              type="checkbox"
              defaultChecked={report?.is_ai_reference ?? true}
              className="mt-0.5 h-4 w-4 accent-primary"
              aria-describedby="isAiReference-help"
            />
            <div className="space-y-1">
              <Label htmlFor="isAiReference">AI 参照対象にする</Label>
              <p id="isAiReference-help" className="text-xs text-muted-foreground">
                オンにすると、承認済み・送信済みのレポートを Bot が回答時に参照します
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="bodyMarkdown">本文（Markdown）</Label>
              <div className="flex gap-1" role="group" aria-label="編集とプレビューの切替">
                <Button
                  type="button"
                  variant={tab === 'edit' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={tab === 'edit'}
                  onClick={() => setTab('edit')}
                >
                  編集
                </Button>
                <Button
                  type="button"
                  variant={tab === 'preview' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={tab === 'preview'}
                  onClick={() => setTab('preview')}
                >
                  プレビュー
                </Button>
              </div>
            </div>
            {/* プレビュー中も FormData に本文が入るよう textarea は隠すだけにする */}
            <Textarea
              id="bodyMarkdown"
              name="bodyMarkdown"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              placeholder={'# 月次学習レポート\n\n## 今月の様子\n\n- '}
              className={tab === 'edit' ? 'font-mono' : 'hidden'}
            />
            {tab === 'preview' && (
              <div className="min-h-[200px] rounded-md border bg-muted/20 px-4 py-3">
                {body.trim() ? (
                  <MarkdownContent markdown={body} />
                ) : (
                  <p className="text-sm text-muted-foreground">本文がまだありません</p>
                )}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            <span aria-hidden="true">*</span>{' '}
            は必須項目です。「承認して保存」すると AI 参照対象（オンの場合）になり、Slack 送信の対象になります
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" name="status" value="approved" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              承認して保存
            </Button>
            <Button
              type="submit"
              name="status"
              value="draft"
              variant="secondary"
              disabled={pending}
            >
              下書き保存
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/admin/reports">キャンセル</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
