/** @file
 * 機能: 「先月分を今すぐ作成して送る」Server Action（管理画面のレポート一覧から呼ぶ）
 * 入力: なし
 * 出力: ActionResult<{ message: string }>（件数とメール結果の日本語メッセージ）
 * 例外: 認証・DB・LLM の失敗は ActionResult に変換（throw しない）
 * 依存: requireAdmin, runManualMonthlyReports, describeResult
 * 副作用: cron と同じ（レポート作成・LLM 課金・メール送信）。一覧の revalidate
 * セキュリティ: LLM 課金とメール送信を伴うため admin のみ（staff は不可）。Server Action は URL 経由でも
 *   叩けるので、UI の出し分けではなくここで必ず検証する。二重送信防止は runMonthlyReports の
 *   emailed_at / 送信権の取得 / Idempotency-Key が効く（このボタンに「送信済みでも再送」は無い）
 * @implements FR-08, FR-13
 */
'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@shared/lib/auth/requireAdmin'
import type { ActionResult } from '@shared/types/action'
import { describeResult } from '../lib/describeResult'
import { runManualMonthlyReports } from '../lib/runtime'

export interface GenerateMonthlyReportsData {
  message: string
}

/** 引数は取らない（useActionState から渡される prevState / FormData は使わない） */
export async function generateMonthlyReportsAction(): Promise<ActionResult<GenerateMonthlyReportsData>> {
  try {
    await requireAdmin()
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message === 'forbidden'
          ? '月次レポートの作成・送信は管理者のみ実行できます'
          : 'ログインが必要です',
    }
  }

  try {
    const result = await runManualMonthlyReports()
    revalidatePath('/admin/reports')
    return { ok: true, data: { message: describeResult(result) } }
  } catch (err) {
    console.error('[generateMonthlyReportsAction] failed', err)
    return { ok: false, error: '実行に失敗しました。時間を置いて再度お試しください' }
  }
}
