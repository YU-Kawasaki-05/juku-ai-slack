/** @file
 * 機能: requireStaff の失敗を Server Action の ActionResult に正規化する
 * 入力: catch した例外
 * 出力: { ok: false, error }
 * 依存: なし
 * セキュリティ: 「未ログイン（unauthorized）」と「ログイン済みだがロール未設定（forbidden）」を
 *   同じ文言にすると、権限が無い人が何度ログインし直しても解決せず原因に辿り着けない。
 *   requireStaff は両者を区別して throw するので、文言もここで分ける
 *   （requireAdmin 側の文言は admin 限定操作ごとに異なるため各アクションで組み立てる）
 * @implements FR-13
 */

/** ログインはできているが app_metadata.role が staff/admin でないとき */
export const NO_STAFF_ROLE_MESSAGE = 'このアカウントには管理画面の利用権限がありません'

export function staffAuthFailure(e: unknown): { ok: false; error: string } {
  return (e as Error)?.message === 'forbidden'
    ? { ok: false, error: NO_STAFF_ROLE_MESSAGE }
    : { ok: false, error: 'ログインが必要です' }
}
