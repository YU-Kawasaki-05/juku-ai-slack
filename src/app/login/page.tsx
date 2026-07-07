/** @file
 * 機能: スタッフログイン（SCR-01）
 * @implements FR-13
 */
import { Metadata } from 'next'
import { GraduationCap } from 'lucide-react'
import LoginForm from './LoginForm'

export const metadata: Metadata = {
  title: 'ログイン | じゅくAI',
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <main className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight">じゅくAI 管理画面</h1>
            <p className="text-sm text-muted-foreground">スタッフアカウントでログイン</p>
          </div>
        </div>
        <LoginForm />
      </main>
    </div>
  )
}
