import { Metadata } from 'next'
import LoginForm from './LoginForm'

export const metadata: Metadata = {
  title: 'ログイン | じゅくAI',
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold">じゅくAI</h1>
          <p className="text-sm text-muted-foreground">管理画面にログイン</p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
