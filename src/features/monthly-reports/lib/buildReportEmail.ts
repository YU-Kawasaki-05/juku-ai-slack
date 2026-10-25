/** @file
 * 機能: 月次レポートのメール（件名・本文）を組み立てる
 * 入力: 対象月、生徒ごとの状況、管理画面のドメイン（任意）
 * 出力: { subject, text }
 * 例外: なし
 * 依存: reportMonth, constants
 * 備考: 本文は生徒ごとの質問数の一覧と、管理画面への案内。レポート本文は添付の .md にある。
 *   宛先はスタッフなので生徒の表示名を載せてよいが、プレーンテキストのみで送る（HTML にしない）
 * @implements FR-08
 */
import { APP_NAME } from '@shared/lib/constants'
import { formatMonthJa } from './reportMonth'

export type StudentMailStatus =
  /** AI が作成した下書きを添付した */
  | 'attached'
  /** スタッフが手で書いたレポートが既にある（上書きしないので添付なし） */
  | 'manual'
  /** 質問が 0 件でレポートを作らなかった */
  | 'no_questions'
  /** 作成に失敗した / 時間切れで未作成 */
  | 'missing'

export interface StudentMailRow {
  displayName: string
  questions: number
  status: StudentMailStatus
}

export interface BuildReportEmailParams {
  month: string
  rows: StudentMailRow[]
  /** 添付した件数（rows の attached と一致するはずだが、本文に出す数はこの値） */
  attachedCount: number
  /** 管理画面のドメイン（'example.vercel.app'。スキームなし）。無ければリンクを出さない */
  adminHost?: string | null
}

function describeRow(row: StudentMailRow): string {
  switch (row.status) {
    case 'attached':
      return `${row.questions}件（レポート添付）`
    case 'manual':
      return `${row.questions}件（手書きのレポートがあるため添付なし）`
    case 'no_questions':
      return '質問なし'
    case 'missing':
      return `${row.questions}件（レポートを作成できていません）`
  }
}

export function buildAdminReportsUrl(adminHost: string | null | undefined, month: string): string | null {
  const host = adminHost?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!host) return null
  return `https://${host}/admin/reports?month=${month}`
}

export function buildReportEmail(params: BuildReportEmailParams): { subject: string; text: string } {
  const monthJa = formatMonthJa(params.month)
  const rows = [...params.rows].sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'))
  const missing = rows.filter((r) => r.status === 'missing')
  const url = buildAdminReportsUrl(params.adminHost, params.month)

  const lines: string[] = [
    `${monthJa}の月次レポート（AI が会話から作った下書き）を、生徒ごとの .md ファイルで添付します。`,
    '内容は AI の下書きです。スタッフが確認・修正してから使ってください。',
    '',
    `■ 生徒ごとの質問数（${monthJa}）`,
    ...(rows.length > 0 ? rows.map((r) => `・${r.displayName}: ${describeRow(r)}`) : ['・対象の生徒がいません']),
  ]

  if (missing.length > 0) {
    lines.push(
      '',
      `※ ${missing.length}名分はレポートを作成できていません。管理画面の「レポート管理」から手で作成してください。`,
    )
  }

  lines.push(
    '',
    '■ 管理画面での確認',
    '「レポート管理」で、状態が「AI下書き」のレポートを確認できます。',
    '承認するまでは Bot の回答には使われません。',
    url ?? '管理画面の「レポート管理」を開き、対象月で絞り込んでください。',
    '',
    `※ このメールは ${APP_NAME} から自動送信されています。`,
  )

  return {
    subject: `【${APP_NAME}】${monthJa}分 月次レポート（AI 下書き ${params.attachedCount}名分）`,
    text: lines.join('\n'),
  }
}
