/** @file
 * 機能: 実行結果（MonthlyReportsResult）を、管理画面のトーストに出す日本語に直す
 * 入力: MonthlyReportsResult
 * 出力: 複数行の文章（改行区切り）
 * 例外: なし
 * 依存: reportMonth
 * @implements FR-08
 */
import { formatMonthJa } from './reportMonth'
import type { MonthlyReportsResult } from './runMonthlyReports'

const MAIL_TEXT: Record<MonthlyReportsResult['mail'], string> = {
  sent: 'メール: 送信しました',
  already_sent: 'メール: この月は送信済みです（再送はしません）',
  not_configured: 'メール: 設定なし（RESEND_API_KEY / RESEND_FROM_EMAIL / REPORT_EMAIL_TO を確認してください）。レポートの作成だけ行いました',
  failed: 'メール: 送信に失敗しました（もう一度押すと再試行します）',
  in_progress: 'メール: 別の実行が送信中です。少し待ってから画面を更新してください',
  deferred: 'メール: まだ送っていません（全員分が揃ったら送ります）',
}

export function describeResult(r: MonthlyReportsResult): string {
  const lines: string[] = [`${formatMonthJa(r.month)}分`]

  if (r.mail === 'already_sent') {
    lines.push(MAIL_TEXT.already_sent)
    return lines.join('\n')
  }

  lines.push(
    `作成 ${r.generated}件 / 作成済み ${r.alreadyGenerated}件 / 手書きあり ${r.manualExisting}件 / 質問なし ${r.noQuestions}名 / 失敗 ${r.failed}件`,
  )
  if (r.generationBlocked === 'ai_paused') {
    lines.push('AI 応答が緊急停止中のため、レポートは作成していません')
  } else if (r.generationBlocked === 'llm_not_configured') {
    lines.push('LLM が未設定のため、レポートは作成していません')
  } else if (r.remaining > 0) {
    const why = r.stoppedBy === 'time' ? '時間' : r.stoppedBy === 'limit' ? '人数' : '失敗'
    lines.push(`あと ${r.remaining}名分が未作成です（${why}の上限・失敗のため）。もう一度押すと続きを作成します`)
  }
  if (r.embeddingFailed > 0) {
    lines.push(`${r.embeddingFailed}件で AI 参照データ（Embedding）を作れませんでした。詳細ページの警告を確認してください`)
  }
  lines.push(MAIL_TEXT[r.mail] + (r.mail === 'failed' && r.mailError ? `（${r.mailError}）` : ''))
  return lines.join('\n')
}
