/** @file
 * 機能: 生徒の作成・更新 Server Action（管理画面フォームから呼ぶ）
 * 入力: FormData（name, displayName, grade, status, guardianEmail[, id]）
 * 出力: ActionResult
 * 例外: 認証エラー・DB エラーは ActionResult.error に変換（throw しない）
 * 依存: requireStaff, createServerClient, personSchema
 * 副作用: persons への insert/update, 一覧の revalidate
 * セキュリティ: requireStaff で認証必須（FR-13）。Service Role はサーバー専用
 * @implements FR-14, AC-14-02, BR-14-02
 */
'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import type { ActionResult } from '@shared/types/action'
import { personCreateSchema, personUpdateSchema } from '../schemas/personSchema'

function readForm(formData: FormData) {
  return {
    name: String(formData.get('name') ?? ''),
    displayName: String(formData.get('displayName') ?? ''),
    grade: String(formData.get('grade') ?? ''),
    status: String(formData.get('status') ?? 'active'),
    guardianEmail: String(formData.get('guardianEmail') ?? ''),
  }
}

export async function createPersonAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  const parsed = personCreateSchema.safeParse(readForm(formData))
  if (!parsed.success) {
    return { ok: false, error: '入力内容を確認してください', fieldErrors: flatten(parsed.error) }
  }

  const db = createServerClient()
  const { error } = await db.from('persons').insert({
    name: parsed.data.name,
    display_name: parsed.data.displayName,
    grade: parsed.data.grade,
    status: parsed.data.status,
    guardian_email: parsed.data.guardianEmail,
  })
  if (error) return { ok: false, error: '保存に失敗しました' }

  revalidatePath('/admin/persons')
  return { ok: true }
}

export async function updatePersonAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  const parsed = personUpdateSchema.safeParse({
    ...readForm(formData),
    id: String(formData.get('id') ?? ''),
  })
  if (!parsed.success) {
    return { ok: false, error: '入力内容を確認してください', fieldErrors: flatten(parsed.error) }
  }

  const db = createServerClient()
  const { error } = await db
    .from('persons')
    .update({
      name: parsed.data.name,
      display_name: parsed.data.displayName,
      grade: parsed.data.grade,
      status: parsed.data.status,
      guardian_email: parsed.data.guardianEmail,
    })
    .eq('id', parsed.data.id)
  if (error) return { ok: false, error: '保存に失敗しました' }

  revalidatePath('/admin/persons')
  revalidatePath(`/admin/persons/${parsed.data.id}`)
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
