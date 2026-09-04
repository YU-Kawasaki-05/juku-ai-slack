/** @file
 * 機能: チャンネル紐付けの操作ログ（誰がいつどのチャンネルをどの生徒に紐付けたか）の
 *   エラーコードと本文の組み立て
 * 入力: key → value のレコード
 * 出力: `key=value` を空白で連結した 1 行
 * 依存: なし
 * 備考: 紐付けを誤ると別生徒のプロフィールとレポートで AI が回答するため、EP-07〜09 を
 *   staff に開放した代わりに操作を必ず記録する（権限設計 3.1 / 07_エラー文言設計）。
 *   `ai_error_logs` に severity=info で入れる（専用テーブルは作らない）。
 *   定数をアクション本体（'use server'）に置けないためここに分けている
 *   （"use server" ファイルは async 関数以外を export できない）
 * @implements FR-15
 */

export const BINDING_CREATED_CODE = 'CHANNEL_BINDING_CREATED'
export const BINDING_UPDATED_CODE = 'CHANNEL_BINDING_UPDATED'

/** 後から grep できるよう形式を固定する。未設定値は `-`（キー自体は必ず残す） */
export function auditLine(fields: Record<string, string | null | undefined>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${v == null || v === '' ? '-' : v}`)
    .join(' ')
}
