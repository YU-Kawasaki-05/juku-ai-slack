/** @file
 * 機能: 管理画面ページ（Server Component）の認証ガード。
 *   未認証は /login、ロール未設定は /admin/no-access へリダイレクト
 * 入力: なし（Cookie セッション）
 * 出力: { userId, email }
 * 例外: リダイレクト時は next/navigation の redirect（NEXT_REDIRECT）を throw
 * 依存: requireStaff
 * セキュリティ: middleware だけに依存すると matcher の設定ミス・除外パスで防御が抜ける。
 *   ページ側でも認証を確認する多層防御（FR-13）
 * UX: ロール未設定（forbidden）を /login に倒すと、ログイン済みなのにログイン画面へ
 *   戻され続ける無限ループに見えて原因が分からない。専用ページで理由と対処を出す
 * @implements FR-13
 */
import 'server-only'
import { redirect } from 'next/navigation'
import { requireStaff, type StaffContext } from './requireStaff'

/** ロールは持たないがログインはできているユーザーの案内先（管理画面シェルの外にある） */
export const NO_ACCESS_PATH = '/admin/no-access'

export async function requireStaffPage(): Promise<StaffContext> {
  try {
    return await requireStaff()
  } catch (e) {
    // forbidden は「ログイン済みだがロール未設定」。/login に戻しても解決しないので案内先を分ける
    redirect((e as Error)?.message === 'forbidden' ? NO_ACCESS_PATH : '/login')
  }
}
