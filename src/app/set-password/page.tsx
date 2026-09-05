/** @file
 * 機能: 招待リンクを受け取った本人がパスワードを設定する画面（SCR-01 の派生）
 * 入力: なし（トークンは URL フラグメントにあり、クライアント側でのみ読める）
 * 出力: SetPasswordForm
 * 配置: `/login` と同じくルート直下。`/admin/*` 配下ではないため管理画面シェルは付かない
 * セキュリティ: **middleware の matcher（/admin/:path*, /login）に含めないこと**。
 *   含めると未認証アクセスが /login にリダイレクトされ、リダイレクト時に
 *   URL フラグメントが失われて招待リンクが機能しなくなる（E2E: auth-guard.spec.ts が固定）
 * @implements FR-13
 */
import { Metadata } from 'next'
import { KeyRound } from 'lucide-react'
import SetPasswordForm from './SetPasswordForm'

export const metadata: Metadata = {
  title: 'パスワードの設定 | じゅくAI',
  // 招待リンクは本人限定。検索エンジンに拾わせない
  robots: { index: false, follow: false },
}

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <main className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight">パスワードの設定</h1>
            <p className="text-sm text-muted-foreground">
              管理画面にログインするためのパスワードを決めてください
            </p>
          </div>
        </div>
        <SetPasswordForm />
      </main>
    </div>
  )
}
