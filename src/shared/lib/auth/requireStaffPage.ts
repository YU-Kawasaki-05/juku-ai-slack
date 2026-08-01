/** @file
 * 機能: 管理画面ページ（Server Component）の認証ガード。未認証は /login へリダイレクト
 * 入力: なし（Cookie セッション）
 * 出力: { userId, email }
 * 例外: 未認証時は next/navigation の redirect（NEXT_REDIRECT）を throw
 * 依存: requireStaff
 * セキュリティ: middleware だけに依存すると matcher の設定ミス・除外パスで防御が抜ける。
 *   ページ側でも認証を確認する多層防御（FR-13）
 * @implements FR-13
 */
import 'server-only'
import { redirect } from 'next/navigation'
import { requireStaff, type StaffContext } from './requireStaff'

export async function requireStaffPage(): Promise<StaffContext> {
  const ctx = await requireStaff().catch(() => null)
  if (!ctx) {
    redirect('/login')
  }
  return ctx
}
