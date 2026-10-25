/** @file
 * 機能: 月次レポートの本体（runMonthlyReports）に、本番の依存（env・DB・LLM・Resend・Slack）を結線する
 * 入力: 実行時刻（省略時は現在）
 * 出力: MonthlyReportsResult
 * 例外: DB の読み書き失敗は throw（cron は 500、管理画面は ActionResult のエラーにする）
 * 依存: env, createServerClient, getLlmClient, getEmbeddingClient, killSwitch, Slack client, sendResendEmail
 * 副作用: runMonthlyReports の副作用すべて
 * セキュリティ: 認可は呼び出し側（cron の Bearer 認証 / requireAdmin）の責務
 * @implements FR-08
 */
import { env } from '@shared/lib/env'
import { MONTHLY_REPORT_FINAL_CRON_DAY } from '@shared/lib/constants'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { postMessage } from '@shared/lib/slack/client'
import { getLlmClient } from '@features/ai-answer'
import { isAIEnabled } from '@features/kill-switch'
import {
  EmbeddingNotConfiguredError,
  getEmbeddingClient,
  rebuildReportEmbeddings,
} from '@features/rag'
import { getPreviousReportMonth, jstParts } from './reportMonth'
import {
  runMonthlyReports,
  type MailConfig,
  type MonthlyReportsResult,
  type RunDeps,
} from './runMonthlyReports'
import { isValidFromAddress, parseRecipients, sendResendEmail } from './sendResendEmail'

/**
 * 3 つ（API キー・送信元・宛先）が揃い、形式が正しいときだけ送れる。1 つでも欠ければ null。
 * 形式の検証は env.ts ではなくここで行う（不正な値で env のパースを落として Slack の回答まで止めないため）。
 * 送信元は `addr` と `Name <addr>` の両方を受け付ける
 */
export function resolveMailConfig(): MailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.RESEND_FROM_EMAIL?.trim()
  const to = parseRecipients(env.REPORT_EMAIL_TO)
  if (from && !isValidFromAddress(from)) {
    console.warn('[monthlyReports] RESEND_FROM_EMAIL の形式が不正です（`addr` か `Name <addr>`）。メール設定なしとして扱います')
    return null
  }
  if (env.REPORT_EMAIL_TO?.trim() && to.length === 0) {
    console.warn('[monthlyReports] REPORT_EMAIL_TO に有効なメールアドレスがありません。メール設定なしとして扱います')
  }
  if (!apiKey || !from || to.length === 0) return null
  return { apiKey, from, to }
}

export function createRunDeps(): RunDeps {
  const db = createServerClient()
  const mail = resolveMailConfig()
  return {
    db,
    getLlm: getLlmClient,
    model: env.LLM_MODEL_DEFAULT,
    mail,
    sendEmail: async (message, idempotencyKey) =>
      mail
        ? sendResendEmail({ ...message, apiKey: mail.apiKey, idempotencyKey })
        : { ok: false, error: 'メール設定なし' },
    adminHost: env.VERCEL_PROJECT_PRODUCTION_URL,
    isAiEnabled: () => isAIEnabled(db),
    rebuildEmbeddings: async (reportId) => {
      try {
        await rebuildReportEmbeddings(db, getEmbeddingClient(), reportId)
      } catch (err) {
        // EMBEDDING_* 未設定は RAG 自体が無効な構成。失敗として数えない
        if (err instanceof EmbeddingNotConfiguredError) return
        throw err
      }
    },
    alert: async (text) => {
      const channel = env.SLACK_ALERTS_CHANNEL_ID
      if (!channel) {
        console.warn('[monthlyReports] SLACK_ALERTS_CHANNEL_ID が未設定のため #alerts 通知をスキップしました')
        return
      }
      try {
        await postMessage({ channel, text })
      } catch (err) {
        console.error('[monthlyReports] #alerts への通知に失敗:', err instanceof Error ? err.message : String(err))
      }
    },
    now: () => Date.now(),
  }
}

/** cron（毎月 1〜3 日 0:00 UTC = 日本時間 9:00）。対象は日本時間の前月。3 日目は最後の試行 */
export async function runScheduledMonthlyReports(now: Date = new Date()): Promise<MonthlyReportsResult> {
  return runMonthlyReports(createRunDeps(), {
    month: getPreviousReportMonth(now),
    finalAttempt: jstParts(now).day >= MONTHLY_REPORT_FINAL_CRON_DAY,
  })
}

/** 管理画面のボタン。対象は日本時間の前月。残りが出たらもう一度押してもらう（最後の試行にはしない） */
export async function runManualMonthlyReports(now: Date = new Date()): Promise<MonthlyReportsResult> {
  return runMonthlyReports(createRunDeps(), { month: getPreviousReportMonth(now) })
}
