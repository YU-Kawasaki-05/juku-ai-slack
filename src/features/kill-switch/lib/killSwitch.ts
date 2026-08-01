/** @file
 * 機能: AI 応答の緊急停止スイッチの読み書き（F-1 / DEC-15）
 * 入力: Supabase クライアント（Service Role）, 切替パラメータ
 * 出力: KillSwitchState / SetAIEnabledResult
 * 例外: 読み取りは投げない（fail-open）。書き込み失敗のみ throw
 * 依存: kill_switches テーブル（migration 031）, Slack client, env
 * 副作用: kill_switches の upsert, 状態変化時の Slack #alerts 通知
 * セキュリティ: 認可は呼び出し側（Server Action の requireAdmin）の責務。
 *   reason / updatedBy は人が入力した文字列なので、Slack 投稿前に必ずエスケープする（C-3）
 * @implements DEC-15, FR-18
 */
import type { ServerDb } from '@shared/types/db'
import { env } from '@shared/lib/env'
import { postMessage } from '@shared/lib/slack/client'
import { escapeSlackText } from '@shared/lib/slack/escapeSlackText'

/** AI 応答（Slack への返信生成）のスイッチ名。kill_switches.name の初期行 */
export const AI_KILL_SWITCH_NAME = 'ai_responses'

export interface KillSwitchState {
  enabled: boolean
  reason: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export interface SetAIEnabledParams {
  enabled: boolean
  reason?: string | null
  /** 操作者（管理画面ログインユーザーのメールアドレス） */
  updatedBy?: string | null
}

export interface SetAIEnabledResult {
  /** 直前の状態から実際に変化したか（変化時のみ #alerts へ通知する） */
  changed: boolean
  /** #alerts へ通知できたか（未設定・送信失敗なら false） */
  notified: boolean
}

/**
 * 行が無い・読めない場合の既定値。
 * fail-open（enabled=true）にするのは、kill_switch の障害で全生徒の質問が無応答になる方が
 * 事故として重いため。逆に「止めたいのに止まらない」ケースは人が気づいて再操作できる。
 */
const FAIL_OPEN_STATE: KillSwitchState = {
  enabled: true,
  reason: null,
  updatedAt: null,
  updatedBy: null,
}

/** 現在のスイッチ状態を読む。読めなければ fail-open な既定値を返す（例外は投げない） */
export async function getAIKillSwitch(db: ServerDb): Promise<KillSwitchState> {
  try {
    const { data, error } = await db
      .from('kill_switches')
      .select('enabled, reason, updated_at, updated_by')
      .eq('name', AI_KILL_SWITCH_NAME)
      .maybeSingle()

    if (error) {
      console.warn('[killSwitch] failed to read kill switch (fail-open):', error.message)
      return FAIL_OPEN_STATE
    }
    if (!data) return FAIL_OPEN_STATE

    return {
      enabled: data.enabled,
      reason: data.reason,
      updatedAt: data.updated_at,
      updatedBy: data.updated_by,
    }
  } catch (err) {
    console.warn(
      '[killSwitch] kill switch lookup threw (fail-open):',
      err instanceof Error ? err.message : String(err),
    )
    return FAIL_OPEN_STATE
  }
}

/** AI 応答が有効か。ジョブ実行の冒頭で必ず通す（LLM 呼び出し前のコスト遮断） */
export async function isAIEnabled(db: ServerDb): Promise<boolean> {
  return (await getAIKillSwitch(db)).enabled
}

/**
 * AI 応答の停止／再開。状態が変化したときだけ #alerts に通知する（DEC-15）。
 * 通知の失敗は切替自体を巻き戻さない（止めたい操作を通知障害で妨げない）。
 */
export async function setAIEnabled(
  db: ServerDb,
  params: SetAIEnabledParams,
): Promise<SetAIEnabledResult> {
  const before = await getAIKillSwitch(db)
  const updatedAt = new Date().toISOString()
  const reason = params.reason?.trim() ? params.reason.trim() : null
  const updatedBy = params.updatedBy?.trim() ? params.updatedBy.trim() : null

  // 行が消えていても復旧できるよう upsert（初期行は migration 031 が入れる）
  const { error } = await db.from('kill_switches').upsert(
    {
      name: AI_KILL_SWITCH_NAME,
      enabled: params.enabled,
      reason,
      updated_at: updatedAt,
      updated_by: updatedBy,
    },
    { onConflict: 'name' },
  )
  if (error) {
    throw new Error(`failed to update kill switch: ${error.message}`)
  }

  if (before.enabled === params.enabled) {
    return { changed: false, notified: false }
  }

  const notified = await notifyKillSwitchChange({
    enabled: params.enabled,
    reason,
    updatedBy,
    updatedAt,
  })
  return { changed: true, notified }
}

const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
})

/** #alerts 用の本文。管理者が Slack だけを見て状況を判断できる情報（誰が・なぜ・いつ）を載せる */
export function buildKillSwitchAlertText(state: {
  enabled: boolean
  reason: string | null
  updatedBy: string | null
  updatedAt: string
}): string {
  const headline = state.enabled
    ? ':white_check_mark: AI応答を再開しました'
    : ':octagonal_sign: AI応答を停止しました（生徒には定型文が返ります）'
  return [
    headline,
    `操作者: ${escapeSlackText(state.updatedBy ?? '不明')}`,
    `理由: ${escapeSlackText(state.reason ?? '（未記入）')}`,
    `時刻: ${jstFormatter.format(new Date(state.updatedAt))}`,
  ].join('\n')
}

async function notifyKillSwitchChange(state: {
  enabled: boolean
  reason: string | null
  updatedBy: string | null
  updatedAt: string
}): Promise<boolean> {
  const channel = env.SLACK_ALERTS_CHANNEL_ID
  if (!channel) {
    // DEC-15 の通知要件は満たせないが、停止操作自体は成功させる（管理画面には状態が出る）
    console.warn(
      '[killSwitch] SLACK_ALERTS_CHANNEL_ID が未設定のため #alerts 通知をスキップしました（DEC-15）',
    )
    return false
  }
  try {
    await postMessage({ channel, text: buildKillSwitchAlertText(state) })
    return true
  } catch (err) {
    console.error(
      '[killSwitch] failed to notify #alerts:',
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}
