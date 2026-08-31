/** @file
 * 機能: 管理画面 Server Action の認証ガード（スタッフ/管理者のみ）
 * 入力: なし（Cookie セッション）
 * 出力: { userId, email }
 * 例外: 未認証は Error('unauthorized')、ロール未設定は Error('forbidden')
 * 依存: Supabase Auth（cookie セッション）
 * セキュリティ: Server Action は URL 経由でも叩けるため、各アクションの冒頭で認証を確認する（FR-13）。
 *   認証だけでは不十分。管理画面は Service Role で DB を読むため RLS（migration 026）を
 *   バイパスする。つまり「サインアップできただけ = ロール未設定」のアカウントでも
 *   全生徒の PII を読めてしまう（AT-05）。権限設計 EP-02〜EP-18 が要求するとおり
 *   app_metadata.role が 'staff' か 'admin' であることをここで強制する。
 *   role の置き場所は app_metadata のみ。user_metadata は本人が auth.updateUser() で
 *   書き換えられるため権限判定に使ってはならない（requireAdmin.ts 参照）。
 * @implements FR-13, FR-14, FR-15
 */
import 'server-only'
import { createAuthServerClient } from '@shared/lib/supabase/authServerClient'

export type StaffRole = 'staff' | 'admin'

export interface StaffContext {
  userId: string
  email: string
  /** 画面の出し分けに使う。認可の判定には必ず requireAdmin / requireStaff を使うこと */
  role: StaffRole
}

export async function requireStaff(): Promise<StaffContext> {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('unauthorized')
  }
  // admin は staff の上位ロール（staff にできることは全てできる）
  const role: unknown = user.app_metadata?.role
  if (role !== 'staff' && role !== 'admin') {
    throw new Error('forbidden')
  }
  return { userId: user.id, email: user.email ?? '', role }
}
