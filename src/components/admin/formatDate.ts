/** @file
 * 機能: 管理画面の日付表示（JST 固定。Server Component から使うためサーバーの TZ に依存させない）
 * @implements FR-14, FR-15, FR-16, FR-17（一覧・詳細の日時表示）
 */
const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeZone: 'Asia/Tokyo',
})

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
})

const monthFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'long',
  timeZone: 'Asia/Tokyo',
})

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso))
}

/** report_month（DATE, 月初日）→「2026年6月」 */
export function formatMonth(isoDate: string): string {
  return monthFormatter.format(new Date(isoDate))
}
