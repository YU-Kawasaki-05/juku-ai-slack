/** @file
 * 機能: レポートの作成・更新・Embedding 再生成 Server Action
 * 入力: FormData
 * 出力: ActionResult（保存系は embeddingWarning を返しうる）
 * 例外: 認証・DB エラーは ActionResult に変換。重複（生徒×月）は専用メッセージ
 * 依存: requireStaff, requireAdmin, createServerClient, reportSchema, rebuildReportEmbeddings
 * 副作用: reports への insert/update、report_chunks の再生成（DEC-14）、一覧の revalidate
 * セキュリティ: requireStaff 必須（FR-13）。Embedding 再生成（手動）は admin のみ（BR-16-02, EP-14）。
 *   person_id はフォーム値を zod で検証しサーバーでのみ使用。Service Role はサーバー専用
 * @implements FR-16, AC-16-01, AC-16-02, BR-16-01, BR-16-02
 */
'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { requireAdmin } from '@shared/lib/auth/requireAdmin'
import type { ActionResult } from '@shared/types/action'
import type { ServerDb } from '@shared/types/db'
import { rebuildReportEmbeddings, getEmbeddingClient } from '@features/rag'
import { reportCreateSchema, reportUpdateSchema } from '../schemas/reportSchema'

const PG_UNIQUE_VIOLATION = '23505'

export interface ReportSaveResult {
  reportId: string
  /** DEC-14 の自動 Embedding 再生成に失敗した場合 true（保存自体は成功） */
  embeddingWarning: boolean
}

function readForm(formData: FormData) {
  return {
    title: String(formData.get('title') ?? ''),
    bodyMarkdown: String(formData.get('bodyMarkdown') ?? ''),
    // checkbox は on / 欠落
    isAiReference: formData.get('isAiReference') === 'on',
    // 押した submit ボタン（下書き保存 / 承認して保存）の value
    status: String(formData.get('status') ?? 'draft'),
  }
}

/** DEC-14: 保存時に自動再生成。失敗しても保存は成功扱い（詳細ページの警告バナーで再生成を促す） */
async function tryRebuildEmbeddings(db: ServerDb, reportId: string): Promise<boolean> {
  try {
    await rebuildReportEmbeddings(db, getEmbeddingClient(), reportId)
    return false
  } catch {
    return true
  }
}

export async function createReportAction(
  _prev: ActionResult<ReportSaveResult> | undefined,
  formData: FormData,
): Promise<ActionResult<ReportSaveResult>> {
  let staffId: string
  try {
    staffId = (await requireStaff()).userId
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  const parsed = reportCreateSchema.safeParse({
    ...readForm(formData),
    personId: String(formData.get('personId') ?? ''),
    reportMonth: String(formData.get('reportMonth') ?? ''),
  })
  if (!parsed.success) {
    return { ok: false, error: '入力内容を確認してください', fieldErrors: flatten(parsed.error) }
  }

  const db = createServerClient()
  const { data: inserted, error } = await db
    .from('reports')
    .insert({
      person_id: parsed.data.personId,
      report_month: parsed.data.reportMonth,
      title: parsed.data.title,
      body_markdown: parsed.data.bodyMarkdown,
      is_ai_reference: parsed.data.isAiReference,
      status: parsed.data.status,
      generated_by_ai: false,
      created_by: staffId,
    })
    .select('id')
    .single()
  if (error || !inserted) {
    if ((error as { code?: string } | null)?.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: 'この生徒のこの月のレポートは既に存在します' }
    }
    return { ok: false, error: '保存に失敗しました' }
  }

  const embeddingWarning = await tryRebuildEmbeddings(db, inserted.id)

  revalidatePath('/admin/reports')
  return { ok: true, data: { reportId: inserted.id, embeddingWarning } }
}

export async function updateReportAction(
  _prev: ActionResult<ReportSaveResult> | undefined,
  formData: FormData,
): Promise<ActionResult<ReportSaveResult>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  const parsed = reportUpdateSchema.safeParse({
    ...readForm(formData),
    id: String(formData.get('id') ?? ''),
  })
  if (!parsed.success) {
    return { ok: false, error: '入力内容を確認してください', fieldErrors: flatten(parsed.error) }
  }

  const db = createServerClient()

  // 本文が変わっていなければ Embedding 再生成は不要（無駄な埋め込み課金を避ける）。
  // RAG の可視条件（is_ai_reference / status）は検索時に RPC 側でフィルタされるため、
  // チャンクは本文の内容だけを反映していればよい。
  const { data: existing } = await db
    .from('reports')
    .select('body_markdown')
    .eq('id', parsed.data.id)
    .maybeSingle()

  // 生徒・対象月は変更不可（reportUpdateSchema と対応）
  const { error } = await db
    .from('reports')
    .update({
      title: parsed.data.title,
      body_markdown: parsed.data.bodyMarkdown,
      is_ai_reference: parsed.data.isAiReference,
      status: parsed.data.status,
    })
    .eq('id', parsed.data.id)
  if (error) return { ok: false, error: '保存に失敗しました' }

  const bodyChanged = (existing?.body_markdown ?? null) !== parsed.data.bodyMarkdown
  const embeddingWarning = bodyChanged ? await tryRebuildEmbeddings(db, parsed.data.id) : false

  revalidatePath('/admin/reports')
  revalidatePath(`/admin/reports/${parsed.data.id}`)
  return { ok: true, data: { reportId: parsed.data.id, embeddingWarning } }
}

export async function rebuildEmbeddingsAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  // BR-16-02 / EP-14: 手動再生成は管理者のみ
  try {
    await requireAdmin()
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message === 'forbidden'
          ? 'Embedding 再生成は管理者のみ実行できます'
          : 'ログインが必要です',
    }
  }

  const id = String(formData.get('id') ?? '')
  if (!id) return { ok: false, error: '対象のレポートが不明です' }

  const db = createServerClient()
  try {
    await rebuildReportEmbeddings(db, getEmbeddingClient(), id)
  } catch {
    return { ok: false, error: 'Embedding の再生成に失敗しました。時間を置いて再度お試しください' }
  }

  revalidatePath('/admin/reports')
  revalidatePath(`/admin/reports/${id}`)
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
