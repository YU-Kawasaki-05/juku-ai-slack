/** @file
 * 機能: 月次レポートが読み書きする DB アクセス（会話の集計・既存レポート・月ごとの実行記録）
 * 入力: Supabase クライアント（Service Role）、対象月 'YYYY-MM' または月初日 'YYYY-MM-01'
 * 出力: 各関数のコメント参照
 * 例外: DB エラーは queryError で文脈を付けて throw
 * 依存: persons, slack_messages, reports, monthly_report_runs
 * 副作用: monthly_report_runs の upsert / update
 * セキュリティ: person_id でのみ生徒を絞る（channel_id ではなく person_id が生徒の識別子, BR-05-11）
 * @implements FR-08
 */
import type { ServerDb } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'
import {
  MONTHLY_REPORT_EMAIL_CLAIM_STALE_MS,
  MONTHLY_REPORT_MAX_MESSAGE_PAGES,
} from '@shared/lib/constants'
import { getMonthBoundsIso } from './reportMonth'
import { summarizeConversation, type ConversationRow, type ConversationStats } from './buildReportPrompt'

/** PostgREST の既定の最大行数（これを超える結果は 1 回では返らない） */
const PAGE_SIZE = 1000
/** 全生徒の 1 か月分の質問を数えるときの最大ページ数（暴走防止。10 万行まで） */
const MAX_STATS_PAGES = 100

export interface ActivePerson {
  id: string
  name: string
  display_name: string | null
}

export function personLabel(p: Pick<ActivePerson, 'name' | 'display_name'>): string {
  return p.display_name?.trim() || p.name
}

/** 有効（active）な生徒。退塾生は対象外（H-6 と同じ扱い）。氏名順で並べて実行ごとの順序を安定させる */
export async function listActivePersons(db: ServerDb): Promise<ActivePerson[]> {
  const { data, error } = await db
    .from('persons')
    .select('id, name, display_name')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw queryError('listActivePersons', error)
  return data ?? []
}

/**
 * 対象月の生徒ごとの質問数・利用日数。会話全体を 1 回なぞって集計する（生徒ごとに数えるクエリを撃たない）。
 * 生徒の発言（role=user）だけを数える。person_id が NULL の行（紐付けのない発言）は対象外
 */
export async function loadQuestionStats(
  db: ServerDb,
  month: string,
): Promise<Map<string, ConversationStats>> {
  const { startIso, endIso } = getMonthBoundsIso(month)
  const byPerson = new Map<string, ConversationRow[]>()

  for (let page = 0; page < MAX_STATS_PAGES; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await db
      .from('slack_messages')
      .select('person_id, role, text, created_at')
      .eq('role', 'user')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw queryError('loadQuestionStats', error)
    for (const row of data ?? []) {
      if (!row.person_id) continue
      const list = byPerson.get(row.person_id) ?? []
      list.push({ role: row.role, text: row.text, created_at: row.created_at })
      byPerson.set(row.person_id, list)
    }
    if (!data || data.length < PAGE_SIZE) break
  }

  const out = new Map<string, ConversationStats>()
  for (const [personId, rows] of byPerson) out.set(personId, summarizeConversation(rows))
  return out
}

/** 生徒 1 人の対象月の会話（user / assistant）を古い順に。上限ページ数で打ち切る */
export async function loadMonthConversation(
  db: ServerDb,
  personId: string,
  month: string,
): Promise<ConversationRow[]> {
  const { startIso, endIso } = getMonthBoundsIso(month)
  const rows: ConversationRow[] = []
  for (let page = 0; page < MONTHLY_REPORT_MAX_MESSAGE_PAGES; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await db
      .from('slack_messages')
      .select('role, text, created_at')
      .eq('person_id', personId)
      .in('role', ['user', 'assistant'])
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw queryError('loadMonthConversation', error)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

export interface ExistingReport {
  id: string
  generatedByAi: boolean
}

/** 対象月に既にあるレポート（生徒 ID → AI 作成か手書きか）。本文は読まない */
export async function loadExistingReports(
  db: ServerDb,
  monthDate: string,
): Promise<Map<string, ExistingReport>> {
  const { data, error } = await db
    .from('reports')
    .select('id, person_id, generated_by_ai')
    .eq('report_month', monthDate)
  if (error) throw queryError('loadExistingReports', error)
  const out = new Map<string, ExistingReport>()
  for (const r of data ?? []) out.set(r.person_id, { id: r.id, generatedByAi: r.generated_by_ai })
  return out
}

/** メールに添付する、対象月の AI 作成レポートの本文（生徒 ID → 本文） */
export async function loadAiReportBodies(
  db: ServerDb,
  monthDate: string,
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('reports')
    .select('person_id, body_markdown')
    .eq('report_month', monthDate)
    .eq('generated_by_ai', true)
  if (error) throw queryError('loadAiReportBodies', error)
  const out = new Map<string, string>()
  for (const r of data ?? []) {
    if (r.body_markdown?.trim()) out.set(r.person_id, r.body_markdown)
  }
  return out
}

export interface RunRecord {
  generatedAt: string | null
  emailedAt: string | null
  emailError: string | null
}

/** 月の実行記録を（無ければ）作って返す。並行して作っても 1 行になる */
export async function ensureRun(db: ServerDb, monthDate: string): Promise<RunRecord> {
  const { error: upsertError } = await db
    .from('monthly_report_runs')
    .upsert({ report_month: monthDate }, { onConflict: 'report_month', ignoreDuplicates: true })
  if (upsertError) throw queryError('ensureRun(upsert)', upsertError)

  const { data, error } = await db
    .from('monthly_report_runs')
    .select('generated_at, emailed_at, email_error')
    .eq('report_month', monthDate)
    .single()
  if (error || !data) throw queryError('ensureRun(select)', error ?? { message: 'row not found' })
  return { generatedAt: data.generated_at, emailedAt: data.emailed_at, emailError: data.email_error }
}

/** 全員分が揃った時刻を記録する（既に入っていれば触らない） */
export async function markGenerated(db: ServerDb, monthDate: string, nowIso: string): Promise<void> {
  const { error } = await db
    .from('monthly_report_runs')
    .update({ generated_at: nowIso })
    .eq('report_month', monthDate)
    .is('generated_at', null)
  if (error) throw queryError('markGenerated', error)
}

/**
 * メール送信の権利を取る。取れたら true（呼び出し側だけが送ってよい）。
 * 条件付き UPDATE 1 文で判定するので、cron と手動ボタンが同時に来ても取れるのは片方だけ。
 *   1. 未送信で、まだ誰も取っていない
 *   2. 未送信で、前の取得が STALE を過ぎている（送信中に異常終了した場合の引き継ぎ）
 */
export async function claimEmailSend(
  db: ServerDb,
  monthDate: string,
  nowMs: number,
): Promise<boolean> {
  const nowIso = new Date(nowMs).toISOString()

  const fresh = await db
    .from('monthly_report_runs')
    .update({ email_claimed_at: nowIso })
    .eq('report_month', monthDate)
    .is('emailed_at', null)
    .is('email_claimed_at', null)
    .select('report_month')
  if (fresh.error) throw queryError('claimEmailSend(fresh)', fresh.error)
  if ((fresh.data ?? []).length > 0) return true

  const staleIso = new Date(nowMs - MONTHLY_REPORT_EMAIL_CLAIM_STALE_MS).toISOString()
  const stale = await db
    .from('monthly_report_runs')
    .update({ email_claimed_at: nowIso })
    .eq('report_month', monthDate)
    .is('emailed_at', null)
    .lt('email_claimed_at', staleIso)
    .select('report_month')
  if (stale.error) throw queryError('claimEmailSend(stale)', stale.error)
  return (stale.data ?? []).length > 0
}

/** 送信成功。以後この月は送らない */
export async function markEmailed(db: ServerDb, monthDate: string, nowIso: string): Promise<void> {
  const { error } = await db
    .from('monthly_report_runs')
    .update({ emailed_at: nowIso, email_error: null, email_claimed_at: null })
    .eq('report_month', monthDate)
  if (error) throw queryError('markEmailed', error)
}

/** 送信失敗。理由を残し、次の実行で再試行できるよう目印を外す */
export async function markEmailFailed(
  db: ServerDb,
  monthDate: string,
  message: string,
): Promise<void> {
  const { error } = await db
    .from('monthly_report_runs')
    .update({ email_error: message.slice(0, 500), email_claimed_at: null })
    .eq('report_month', monthDate)
  if (error) throw queryError('markEmailFailed', error)
}
