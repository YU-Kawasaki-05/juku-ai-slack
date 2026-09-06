/** @file
 * 機能: AI 用プロフィール・試験期間の編集フォーム（SCR-04 の AI プロフィールセクション）
 * 備考: 保存後もこのページに留まる（基本情報フォームと違い一覧へ遷移しない）。
 *   H-9 と同じく成功直後は保存ボタンを無効にするが、編集を再開したら押せるように戻す
 *   （UPSERT なので二重送信で行が増えることはない。無効のまま固定すると連続編集ができなくなる）
 * @implements FR-09, AC-09-01, DEC-18
 */
'use client'

import { useActionState, useEffect, useState } from 'react'
import { AlertCircle, Info, Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'
import { FieldError } from '@/components/admin/FieldError'
import type { ActionResult } from '@shared/types/action'
import type { Tables } from '@shared/types/db'
import type { ExamPeriodDefaults } from '../lib/examPeriod'

type ProfileAction = (prev: ActionResult | undefined, fd: FormData) => Promise<ActionResult>

export function StudentProfileForm({
  action,
  personId,
  profile,
  examPeriod,
  today,
}: {
  action: ProfileAction
  personId: string
  profile: Tables<'student_profiles'> | null
  /** 保存済み exam_mode_until から作った初期値（判定はサーバー時刻で行う） */
  examPeriod: ExamPeriodDefaults
  /** 今日（JST）。date 入力の min。サーバーで計算して渡す */
  today: string
}) {
  const [state, formAction, pending] = useActionState(action, undefined)
  const [examMode, setExamMode] = useState(examPeriod.active)
  // 保存成功後に編集を再開したかどうか（再送信を許可する条件）
  const [edited, setEdited] = useState(false)

  useEffect(() => {
    if (state?.ok) {
      toast({ description: 'AI 用プロフィールを保存しました' })
      setEdited(false)
    }
  }, [state])

  const err = state && !state.ok ? state : undefined
  const saved = state?.ok === true && !edited

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>AI 用プロフィール</CardTitle>
        <p className="text-sm text-muted-foreground">
          AI が回答時に参照する生徒の特徴・学習状況メモです。すべての質問への回答に使われます
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} onChange={() => setEdited(true)} className="space-y-5">
          <input type="hidden" name="personId" value={personId} />

          {err && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{err.error}</AlertDescription>
            </Alert>
          )}

          {/* 自由記述はそのまま外部 LLM に渡る。氏名を書かせないための注意書き（学年は persons.grade から自動で入る） */}
          <Alert role="note">
            <Info className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              ここに入力した内容はそのまま AI に送信されます。
              生徒の氏名は書かないでください（学年は生徒情報から自動で送られます）
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="summary">全体要約</Label>
            <Textarea
              id="summary"
              name="summary"
              rows={4}
              defaultValue={profile?.summary ?? ''}
              maxLength={2000}
              placeholder="例: 中学3年。数学は基礎計算は安定してきたが、文章題で条件を式に落とすところでつまずきやすい。"
              aria-invalid={err?.fieldErrors?.summary ? true : undefined}
              aria-describedby={
                err?.fieldErrors?.summary ? 'summary-error summary-help' : 'summary-help'
              }
            />
            <FieldError id="summary-error" message={err?.fieldErrors?.summary} />
            <p id="summary-help" className="text-xs text-muted-foreground">
              現在の学習状況と直近の重点課題。200〜800 文字程度が目安です
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="learningStyle">学習スタイル・説明トーン</Label>
            <Textarea
              id="learningStyle"
              name="learningStyle"
              rows={2}
              defaultValue={profile?.learning_style ?? ''}
              maxLength={500}
              placeholder="例: 図を使った説明が入りやすい。長文の説明は読み飛ばしがち。"
              aria-invalid={err?.fieldErrors?.learningStyle ? true : undefined}
              aria-describedby={err?.fieldErrors?.learningStyle ? 'learningStyle-error' : undefined}
            />
            <FieldError id="learningStyle-error" message={err?.fieldErrors?.learningStyle} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="strengths">得意分野</Label>
            <Textarea
              id="strengths"
              name="strengths"
              rows={2}
              defaultValue={profile?.strengths ?? ''}
              maxLength={500}
              aria-invalid={err?.fieldErrors?.strengths ? true : undefined}
              aria-describedby={err?.fieldErrors?.strengths ? 'strengths-error' : undefined}
            />
            <FieldError id="strengths-error" message={err?.fieldErrors?.strengths} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="weaknesses">苦手分野</Label>
            <Textarea
              id="weaknesses"
              name="weaknesses"
              rows={2}
              defaultValue={profile?.weaknesses ?? ''}
              maxLength={500}
              aria-invalid={err?.fieldErrors?.weaknesses ? true : undefined}
              aria-describedby={err?.fieldErrors?.weaknesses ? 'weaknesses-error' : undefined}
            />
            <FieldError id="weaknesses-error" message={err?.fieldErrors?.weaknesses} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="instructionNotes">指導上の注意</Label>
            <Textarea
              id="instructionNotes"
              name="instructionNotes"
              rows={2}
              defaultValue={profile?.instruction_notes ?? ''}
              maxLength={1000}
              placeholder="例: 答えをすぐ出すと写して終わりになりやすいので、まず考え方から。"
              aria-invalid={err?.fieldErrors?.instructionNotes ? true : undefined}
              aria-describedby={
                err?.fieldErrors?.instructionNotes ? 'instructionNotes-error' : undefined
              }
            />
            <FieldError id="instructionNotes-error" message={err?.fieldErrors?.instructionNotes} />
          </div>

          <fieldset className="space-y-4 rounded-md border p-4">
            <legend className="px-1 text-sm font-medium">試験期間</legend>

            <div className="flex items-start gap-2">
              <input
                id="examMode"
                name="examMode"
                type="checkbox"
                checked={examMode}
                onChange={(e) => setExamMode(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary"
                aria-describedby="examMode-help"
              />
              <div className="space-y-1">
                <Label htmlFor="examMode">試験期間中にする</Label>
                <p id="examMode-help" className="text-xs text-muted-foreground">
                  試験期間中は、確認の質問をはさまず、要点をすばやく伝える回答に切り替わります。
                  最終日を過ぎると自動で通常の回答に戻ります
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="examEndDate">
                最終日
                {examMode && (
                  <span className="text-destructive" aria-hidden="true">
                    {' '}
                    *
                  </span>
                )}
              </Label>
              <Input
                id="examEndDate"
                name="examEndDate"
                type="date"
                className="max-w-48"
                min={today}
                defaultValue={examPeriod.endDate}
                disabled={!examMode}
                aria-invalid={err?.fieldErrors?.examEndDate ? true : undefined}
                aria-describedby={
                  err?.fieldErrors?.examEndDate ? 'examEndDate-error examEndDate-help' : 'examEndDate-help'
                }
              />
              <FieldError id="examEndDate-error" message={err?.fieldErrors?.examEndDate} />
              <p id="examEndDate-help" className="text-xs text-muted-foreground">
                この日いっぱいまで試験期間として扱います
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="examSubjects">試験科目（任意）</Label>
              <Input
                id="examSubjects"
                name="examSubjects"
                defaultValue={(profile?.exam_subjects ?? []).join(', ')}
                placeholder="数学, 英語"
                aria-invalid={err?.fieldErrors?.examSubjects ? true : undefined}
                aria-describedby={
                  err?.fieldErrors?.examSubjects
                    ? 'examSubjects-error examSubjects-help'
                    : 'examSubjects-help'
                }
              />
              <FieldError id="examSubjects-error" message={err?.fieldErrors?.examSubjects} />
              <p id="examSubjects-help" className="text-xs text-muted-foreground">
                カンマ区切りで入力します
              </p>
            </div>
          </fieldset>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={pending || saved}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending ? '保存中...' : 'プロフィールを保存'}
            </Button>
            {/* ボタンが無効な理由を見せる。読み上げは toast 側で行うのでここでは live region にしない */}
            {saved && <span className="text-sm text-muted-foreground">保存しました</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
