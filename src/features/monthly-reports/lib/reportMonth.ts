/** @file
 * 機能: 月次レポートの対象月（日本時間）の判定と、月の境界・日付キーの計算
 * 入力: Date / 'YYYY-MM'
 * 出力: 'YYYY-MM'、UTC の ISO 境界、日本時間の日付キー
 * 例外: 'YYYY-MM' 以外の入力は Error
 * 依存: なし（純粋関数）
 * 備考: サーバーの TZ（Vercel は UTC）に依存させない。月初の 0:00〜8:59 JST は UTC ではまだ前月末なので、
 *   UTC のまま月を判定すると「前月」が 1 か月ずれる
 * @implements FR-08
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

/** 日本時間での年・月（1〜12）・日 */
export function jstParts(now: Date): { year: number; month: number; day: number } {
  const jst = new Date(now.getTime() + JST_OFFSET_MS)
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1, day: jst.getUTCDate() }
}

export function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** 日本時間で見た「前月」の 'YYYY-MM'（年またぎ対応） */
export function getPreviousReportMonth(now: Date): string {
  const { year, month } = jstParts(now)
  return month === 1 ? formatYearMonth(year - 1, 12) : formatYearMonth(year, month - 1)
}

export function isReportMonth(value: string): boolean {
  return MONTH_RE.test(value)
}

function parseMonth(month: string): { year: number; month: number } {
  const m = MONTH_RE.exec(month)
  if (!m) throw new Error(`invalid report month: ${month}`)
  return { year: Number(m[1]), month: Number(m[2]) }
}

/** reports.report_month / monthly_report_runs.report_month に入れる月初日 */
export function toReportMonthDate(month: string): string {
  parseMonth(month)
  return `${month}-01`
}

/**
 * 対象月（日本時間の月初 0:00 〜 翌月初 0:00）を UTC の ISO 文字列で返す。
 * 範囲は [startIso, endIso)。created_at の timestamptz と比べるのに使う
 */
export function getMonthBoundsIso(month: string): { startIso: string; endIso: string } {
  const { year, month: m } = parseMonth(month)
  const start = Date.UTC(year, m - 1, 1) - JST_OFFSET_MS
  const end = Date.UTC(year, m, 1) - JST_OFFSET_MS
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() }
}

/** timestamptz 文字列 → 日本時間の 'YYYY-MM-DD'（利用日数の集計用） */
export function toJstDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 日本時間の 'MM/DD HH:mm'（プロンプトに載せる質問の時刻） */
export function toJstShortStamp(iso: string): string {
  const s = new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString()
  return `${s.slice(5, 10).replace('-', '/')} ${s.slice(11, 16)}`
}

/** 'YYYY-MM' → '2026年9月' */
export function formatMonthJa(month: string): string {
  const { year, month: m } = parseMonth(month)
  return `${year}年${m}月`
}
