/** @file
 * 機能: 月次レポートの自動作成・メール送付の cron エンドポイント（GET /api/cron/monthly-reports）
 * 入力: Authorization: Bearer <CRON_SECRET>（Vercel Cron が自動で付ける）
 * 出力: 200 + 実行結果の件数（生徒名は含めない）。認証 NG は 401、DB 障害などは 500
 * 例外: 想定外の失敗は 500 を返し、ai_error_logs に残す
 * 依存: env, runScheduledMonthlyReports, verifyCronAuth
 * 副作用: レポート作成・LLM 課金・メール送信（vercel.json の cron: 毎月 1〜3 日 0:00 UTC = 日本時間 9:00）
 * セキュリティ: CRON_SECRET が無い・違うときは 401（未設定でも通す fail-open にしない）。
 *   DEC-13 は「Slack への即時応答の経路で Cron を使わない」決定で、このバッチ用途は対象外
 * @implements FR-08, DEC-16
 */
import { NextResponse } from 'next/server'
import { env } from '@shared/lib/env'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { logError } from '@features/error-logs'
import { runScheduledMonthlyReports, verifyCronAuth } from '@features/monthly-reports'

export const runtime = 'nodejs'
/** cron は毎回実行したいのでキャッシュさせない */
export const dynamic = 'force-dynamic'
/** LLM を数人ずつ呼ぶため、既定の実行時間では足りない（上限内で止める設計。constants の MONTHLY_REPORT_TIME_BUDGET_MS 参照） */
export const maxDuration = 300

export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronAuth(request.headers.get('authorization'), env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await runScheduledMonthlyReports()
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    console.error('[cron/monthly-reports] failed', err)
    await logError(createServerClient(), {
      code: 'MONTHLY_REPORT_FAILED',
      severity: 'error',
      internalMessage: `monthly-reports cron failed: ${err instanceof Error ? err.message : String(err)}`,
      rawError: err,
    })
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
