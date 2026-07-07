/** @file
 * 機能: 管理者専用 Server Action の認証ガード（app_metadata.role = 'admin' のみ）
 * 入力: なし（Cookie セッション）
 * 出力: { userId, email }
 * 例外: 未認証は Error('unauthorized')、権限不足は Error('forbidden')
 * 依存: createAuthServerClient（Cookie セッションからユーザー取得）
 * セキュリティ: Embedding 再生成など admin 限定操作（EP-14, BR-16-02）に使用。
 *   role は Supabase Auth の app_metadata.role（03_権限設計）。
 *   user_metadata はログイン中のユーザー自身が auth.updateUser() で書き換えられるため
 *   権限判定に使ってはならない（権限昇格）。app_metadata は Service Role / Admin API
 *   でしか変更できない
 * @implements FR-13, FR-16, BR-16-02
 */
import 'server-only'
import { createAuthServerClient } from '@shared/lib/supabase/authServerClient'
import type { StaffContext } from './requireStaff'

export async function requireAdmin(): Promise<StaffContext> {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('unauthorized')
  }
  if (user.app_metadata?.role !== 'admin') {
    throw new Error('forbidden')
  }
  return { userId: user.id, email: user.email ?? '' }
}
