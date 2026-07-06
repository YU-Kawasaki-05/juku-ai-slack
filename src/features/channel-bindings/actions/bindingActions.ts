/** @file
 * 機能: チャンネル紐付けの作成・更新 Server Action
 * 入力: FormData
 * 出力: ActionResult
 * 例外: 認証・DB エラーは ActionResult に変換。重複チャンネルは専用メッセージ（AC-15-03）
 * 依存: requireStaff, createServerClient, bindingSchema
 * 副作用: slack_channel_bindings への insert/update
 * セキュリティ: requireStaff（FR-13）。channel_id が信頼の基点（BR-07-01）
 * @implements FR-15, AC-15-01, AC-15-02, AC-15-03, BR-15-01, BR-15-03
 */
'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import type { ActionResult } from '@shared/types/action'
import { bindingCreateSchema, bindingUpdateSchema } from '../schemas/bindingSchema'

const PG_UNIQUE_VIOLATION = '23505'

export async function createBindingAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  const parsed = bindingCreateSchema.safeParse({
    slackTeamId: String(formData.get('slackTeamId') ?? ''),
    slackChannelId: String(formData.get('slackChannelId') ?? ''),
    slackChannelName: String(formData.get('slackChannelName') ?? ''),
    personId: String(formData.get('personId') ?? ''),
    status: String(formData.get('status') ?? 'active'),
  })
  if (!parsed.success) {
    return { ok: false, error: '入力内容を確認してください' }
  }

  const db = createServerClient()
  // 生徒名スナップショット（表示用）
  const { data: person } = await db
    .from('persons')
    .select('name')
    .eq('id', parsed.data.personId)
    .maybeSingle()

  const { error } = await db.from('slack_channel_bindings').insert({
    slack_team_id: parsed.data.slackTeamId,
    slack_channel_id: parsed.data.slackChannelId,
    slack_channel_name: parsed.data.slackChannelName,
    person_id: parsed.data.personId,
    person_name_snapshot: person?.name ?? null,
    status: parsed.data.status,
  })
  if (error) {
    // BR-15-03 / AC-15-03: チャンネルIDは一意
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: 'このチャンネルはすでに紐付けされています' }
    }
    return { ok: false, error: '保存に失敗しました' }
  }

  revalidatePath('/admin/channels')
  return { ok: true }
}

export async function updateBindingAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  const parsed = bindingUpdateSchema.safeParse({
    id: String(formData.get('id') ?? ''),
    slackChannelName: String(formData.get('slackChannelName') ?? ''),
    status: String(formData.get('status') ?? 'active'),
  })
  if (!parsed.success) {
    return { ok: false, error: '入力内容を確認してください' }
  }

  const db = createServerClient()
  // BR-15-01: channel_id は変更不可。name/status のみ更新
  const { error } = await db
    .from('slack_channel_bindings')
    .update({ slack_channel_name: parsed.data.slackChannelName, status: parsed.data.status })
    .eq('id', parsed.data.id)
  if (error) return { ok: false, error: '保存に失敗しました' }

  revalidatePath('/admin/channels')
  return { ok: true }
}
