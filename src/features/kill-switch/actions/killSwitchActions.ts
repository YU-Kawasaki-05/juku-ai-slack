/** @file
 * 機能: AI 応答の停止／再開 Server Action（管理画面ダッシュボードから呼ぶ）
 * 入力: FormData（enabled, reason）
 * 出力: ActionResult<{ notified: boolean }>
 * 例外: 認証・DB エラーは ActionResult に変換（throw しない）
 * 依存: requireAdmin, createServerClient, setAIEnabled
 * 副作用: kill_switches の更新、変化時の Slack #alerts 通知、ダッシュボードの revalidate
 * セキュリティ: 全生徒の AI 応答を止める操作のため admin のみ（staff は閲覧のみ）。
 *   Server Action は URL 経由でも叩けるので、UI の出し分けではなくここで必ず検証する
 * @implements DEC-15, FR-13, FR-18
 */
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { requireAdmin } from '@shared/lib/auth/requireAdmin'
import type { ActionResult } from '@shared/types/action'
import { setAIEnabled } from '../lib/killSwitch'

export interface ToggleAiResult {
  enabled: boolean
  /** #alerts へ通知できたか（SLACK_ALERTS_CHANNEL_ID 未設定・送信失敗なら false） */
  notified: boolean
}

const toggleSchema = z.object({
  enabled: z.enum(['true', 'false']).transform((v) => v === 'true'),
  reason: z.string().max(500, '理由は500文字以内で入力してください'),
})

export async function toggleAiResponsesAction(
  _prev: ActionResult<ToggleAiResult> | undefined,
  formData: FormData,
): Promise<ActionResult<ToggleAiResult>> {
  let email: string
  try {
    email = (await requireAdmin()).email
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message === 'forbidden'
          ? 'AI応答の停止・再開は管理者のみ実行できます'
          : 'ログインが必要です',
    }
  }

  const parsed = toggleSchema.safeParse({
    enabled: String(formData.get('enabled') ?? ''),
    reason: String(formData.get('reason') ?? ''),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容を確認してください' }
  }

  const db = createServerClient()
  let result: { changed: boolean; notified: boolean }
  try {
    result = await setAIEnabled(db, {
      enabled: parsed.data.enabled,
      reason: parsed.data.reason,
      updatedBy: email,
    })
  } catch {
    return { ok: false, error: '切り替えに失敗しました。時間を置いて再度お試しください' }
  }

  revalidatePath('/admin')
  return { ok: true, data: { enabled: parsed.data.enabled, notified: result.notified } }
}
