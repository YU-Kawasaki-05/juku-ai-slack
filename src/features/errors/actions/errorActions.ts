/** @file
 * 機能: エラーログの対応済みトグル・メモ保存 Server Action
 * 入力: FormData
 * 出力: ActionResult
 * 例外: 認証・DB エラーは ActionResult に変換
 * 依存: requireStaff, createServerClient, errorLogSchema
 * 副作用: ai_error_logs の update、一覧/詳細の revalidate
 * セキュリティ: requireStaff 必須（FR-13, EP-17 は staff/admin とも可）。
 *   resolved は手動でのみ変更（BR-17-03）。Service Role はサーバー専用
 * @implements FR-17, AC-17-02, AC-17-03, BR-17-03
 */
'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import type { ActionResult } from '@shared/types/action'
import { errorNotesSchema, resolveErrorSchema } from '../schemas/errorLogSchema'

export async function resolveErrorAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  const parsed = resolveErrorSchema.safeParse({
    id: String(formData.get('id') ?? ''),
    resolved: String(formData.get('resolved') ?? ''),
  })
  if (!parsed.success) {
    return { ok: false, error: '入力内容を確認してください' }
  }

  const db = createServerClient()
  const { error } = await db
    .from('ai_error_logs')
    .update({ resolved: parsed.data.resolved })
    .eq('id', parsed.data.id)
  if (error) return { ok: false, error: '更新に失敗しました' }

  revalidatePath('/admin/errors')
  revalidatePath(`/admin/errors/${parsed.data.id}`)
  revalidatePath('/admin')
  return { ok: true }
}

export async function updateErrorNotesAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  const parsed = errorNotesSchema.safeParse({
    id: String(formData.get('id') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  })
  if (!parsed.success) {
    return { ok: false, error: '入力内容を確認してください', fieldErrors: flatten(parsed.error) }
  }

  const db = createServerClient()
  const { error } = await db
    .from('ai_error_logs')
    .update({ notes: parsed.data.notes })
    .eq('id', parsed.data.id)
  if (error) return { ok: false, error: '保存に失敗しました' }

  revalidatePath(`/admin/errors/${parsed.data.id}`)
  return { ok: true }
}

function flatten(err: import('zod').ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.')
    if (key && !out[key]) out[key] = issue.message
  }
  return out
}
