/** E2E テストユーザーと storageState の置き場所。global-setup と各 spec で共有する */

export const ADMIN_STATE = 'e2e/.auth/admin.json'
export const STAFF_STATE = 'e2e/.auth/staff.json'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`E2E: ${name} が未設定です（.env.test を確認）`)
  return value
}

export const testUsers = {
  admin: {
    get email() {
      return required('TEST_ADMIN_EMAIL')
    },
    get password() {
      return required('TEST_ADMIN_PASSWORD')
    },
    role: 'admin',
  },
  staff: {
    get email() {
      return required('TEST_STAFF_EMAIL')
    },
    get password() {
      return required('TEST_STAFF_PASSWORD')
    },
    role: 'staff',
  },
  /**
   * ログアウト専用。supabase.auth.signOut() は既定で scope='global'（そのユーザーの
   * 全セッションを失効させる）なので、admin/staff と共有すると並列実行中の他テストの
   * セッションまで巻き添えで切れる。ログアウトの検証だけ別ユーザーに隔離する。
   */
  logout: {
    get email() {
      return required('TEST_LOGOUT_EMAIL')
    },
    get password() {
      return required('TEST_LOGOUT_PASSWORD')
    },
    role: 'staff',
  },
} as const
