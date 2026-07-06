/** @file
 * 機能: 管理画面 Server Action の認証ガード（スタッフ/管理者のみ）
 * 入力: なし（Cookie セッション）
 * 出力: { userId, email }
 * 例外: 未認証は Error('unauthorized')
 * 依存: Supabase Auth（cookie セッション）
 * セキュリティ: Server Action は URL 経由でも叩けるため、各アクションの冒頭で認証を確認する（FR-13）
 * @implements FR-13, FR-14, FR-15
 */
import 'server-only'
import { createAuthServerClient } from '@shared/lib/supabase/authServerClient'

export interface StaffContext {
  userId: string
  email: string
}

export async function requireStaff(): Promise<StaffContext> {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('unauthorized')
  }
  return { userId: user.id, email: user.email ?? '' }
}
