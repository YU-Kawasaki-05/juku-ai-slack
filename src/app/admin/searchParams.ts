/** @file
 * 機能: 管理画面の URL クエリ検証（H-4）
 * 背景: 以前は UUID を `/^[0-9a-f-]{36}$/i` のような緩い形で判定していたため、
 *   `------------------------------------` のような 36 文字の文字列がそのまま
 *   Postgres の uuid カラム比較に渡り 22P02（invalid input syntax）→ 画面 500 になっていた。
 *   URL を手編集しただけで落ちるのは運用上まずいので、不正値は「フィルタなし」に倒す。
 * @implements FR-16, FR-19
 */

/** UUID の完全形（ハイフン位置・桁数まで固定） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** input[type=month] と同じ 'YYYY-MM'（月は 01-12 のみ） */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** UUID として妥当なら返す。不正値・未指定は undefined（＝フィルタなし） */
export function parseUuidParam(value: string | undefined): string | undefined {
  return isUuid(value) ? value : undefined
}

/** 'YYYY-MM' として妥当なら返す。不正値・未指定は undefined（＝フィルタなし） */
export function parseMonthParam(value: string | undefined): string | undefined {
  return typeof value === 'string' && MONTH_RE.test(value) ? value : undefined
}

/** 1 以上の整数のページ番号。不正値・未指定は 1 */
export function parsePageParam(value: string | undefined): number {
  if (typeof value !== 'string' || !/^\d{1,6}$/.test(value)) return 1
  return Math.max(1, Number(value))
}
