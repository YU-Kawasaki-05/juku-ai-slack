/** @file
 * 機能: チャンネル紐付けの作成・更新 Server Action
 * 入力: FormData
 * 出力: ActionResult
 * 例外: 認証・DB エラーは ActionResult に変換。重複チャンネルは専用メッセージ（AC-15-03）
 * 依存: requireStaff, createServerClient, bindingSchema, logError
 * 副作用: slack_channel_bindings への insert/update、ai_error_logs への操作ログ（severity=info）
 * セキュリティ: requireStaff（権限設計 EP-07〜09。生徒チャンネルの紐付けは各スタッフが行う運用）。
 *   channel_id は「誰の質問か」を決める信頼の基点（BR-07-01）で、誤ると別生徒の
 *   プロフィールとレポートで AI が回答する。admin 限定という入口の制限を外す代わりに、
 *   (1) フォーム側の生徒名つき確認ダイアログ、(2) 既定レポートの生徒一致検査（既存）、
 *   (3) 誰がどの紐付けを作成・変更したかの操作ログ、の 3 段で誤操作を抑える
 * @implements FR-13, FR-15, AC-15-01, AC-15-02, AC-15-03, BR-15-01, BR-15-03
 */
'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { staffAuthFailure } from '@shared/lib/auth/authFailure'
import { logError } from '@features/error-logs'
import type { ActionResult } from '@shared/types/action'
import { bindingCreateSchema, bindingUpdateSchema } from '../schemas/bindingSchema'
import { BINDING_CREATED_CODE, BINDING_UPDATED_CODE, auditLine } from '../lib/auditLog'

const PG_UNIQUE_VIOLATION = '23505'

/** Zod の issue をフィールド名 → 先頭メッセージに畳む（H-8: フォームの各項目に表示するため） */
function flatten(err: import('zod').ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.')
    if (key && !out[key]) out[key] = issue.message
  }
  return out
}

export async function createBindingAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  let actor: string
  try {
    actor = (await requireStaff()).email
  } catch (e) {
    return staffAuthFailure(e)
  }

  const parsed = bindingCreateSchema.safeParse({
    slackTeamId: String(formData.get('slackTeamId') ?? ''),
    slackChannelId: String(formData.get('slackChannelId') ?? ''),
    slackChannelName: String(formData.get('slackChannelName') ?? ''),
    personId: String(formData.get('personId') ?? ''),
    defaultReportId: String(formData.get('defaultReportId') ?? ''),
    status: String(formData.get('status') ?? 'active'),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: '入力内容を確認してください',
      fieldErrors: flatten(parsed.error),
    }
  }

  const db = createServerClient()
  // 生徒名スナップショット（表示用）。読み取り失敗を握りつぶすと null で保存され原因が追えない
  const { data: person, error: personError } = await db
    .from('persons')
    .select('name')
    .eq('id', parsed.data.personId)
    .maybeSingle()
  if (personError) {
    return { ok: false, error: '生徒情報の取得に失敗しました' }
  }
  if (!person) {
    return { ok: false, error: '指定された生徒が見つかりません' }
  }

  // 既定レポートは必ず当該生徒のものに限る。他生徒のレポートを既定にすると
  // そのチャンネルの回答に別生徒のレポート内容が混入する（BR-05-11 と同じ隔離要件）
  if (parsed.data.defaultReportId) {
    const { data: report, error: reportError } = await db
      .from('reports')
      .select('person_id')
      .eq('id', parsed.data.defaultReportId)
      .maybeSingle()
    if (reportError) {
      return { ok: false, error: 'レポート情報の取得に失敗しました' }
    }
    if (!report || report.person_id !== parsed.data.personId) {
      return {
        ok: false,
        error: '入力内容を確認してください',
        fieldErrors: { defaultReportId: 'この生徒のレポートを選択してください' },
      }
    }
  }

  const { error } = await db.from('slack_channel_bindings').insert({
    slack_team_id: parsed.data.slackTeamId,
    slack_channel_id: parsed.data.slackChannelId,
    slack_channel_name: parsed.data.slackChannelName,
    person_id: parsed.data.personId,
    person_name_snapshot: person.name,
    default_report_id: parsed.data.defaultReportId,
    status: parsed.data.status,
  })
  if (error) {
    // BR-15-03 / AC-15-03: チャンネルIDは一意
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: 'このチャンネルはすでに紐付けされています' }
    }
    return { ok: false, error: '保存に失敗しました' }
  }

  // 紐付けを誤ると別生徒として回答してしまうため、誰がどの対応付けを作ったかを必ず残す。
  // dedupeWhileUnresolved は使わない（操作ログは毎回 1 行積む必要がある）
  await logError(db, {
    code: BINDING_CREATED_CODE,
    severity: 'info',
    channelId: parsed.data.slackChannelId,
    personId: parsed.data.personId,
    internalMessage: auditLine({
      actor,
      channel_id: parsed.data.slackChannelId,
      channel_name: parsed.data.slackChannelName,
      person_id: parsed.data.personId,
      person_name: person.name,
      default_report_id: parsed.data.defaultReportId,
      status: parsed.data.status,
    }),
  })

  revalidatePath('/admin/channels')
  return { ok: true }
}

export async function updateBindingAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  let actor: string
  try {
    actor = (await requireStaff()).email
  } catch (e) {
    return staffAuthFailure(e)
  }

  const parsed = bindingUpdateSchema.safeParse({
    id: String(formData.get('id') ?? ''),
    slackChannelName: String(formData.get('slackChannelName') ?? ''),
    status: String(formData.get('status') ?? 'active'),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: '入力内容を確認してください',
      fieldErrors: flatten(parsed.error),
    }
  }

  const db = createServerClient()
  // 操作ログに「どのチャンネルがどの生徒として扱われていたか」を残すための変更前スナップショット。
  // 読めなくても更新自体は続ける（操作者の記録が消える方が困る）ので null 許容で扱う
  const { data: before } = await db
    .from('slack_channel_bindings')
    .select('slack_channel_id, person_id, status')
    .eq('id', parsed.data.id)
    .maybeSingle()

  // BR-15-01: channel_id は変更不可。name/status のみ更新
  const { error } = await db
    .from('slack_channel_bindings')
    .update({ slack_channel_name: parsed.data.slackChannelName, status: parsed.data.status })
    .eq('id', parsed.data.id)
  if (error) return { ok: false, error: '保存に失敗しました' }

  // person_id は UI から変更できない（BR-15-01）が、before/after を並べて残すことで
  // 「付け替わっていないこと」自体が後から検証できる
  await logError(db, {
    code: BINDING_UPDATED_CODE,
    severity: 'info',
    channelId: before?.slack_channel_id ?? null,
    personId: before?.person_id ?? null,
    internalMessage: auditLine({
      actor,
      binding_id: parsed.data.id,
      channel_id: before?.slack_channel_id,
      channel_name: parsed.data.slackChannelName,
      person_id_before: before?.person_id,
      person_id_after: before?.person_id,
      status_before: before?.status,
      status_after: parsed.data.status,
    }),
  })

  revalidatePath('/admin/channels')
  // H-12: 詳細ページも再検証しないと編集直後に古い値が残る（Router Cache / staleTimes 設定時に顕在化）
  revalidatePath(`/admin/channels/${parsed.data.id}`)
  return { ok: true }
}
