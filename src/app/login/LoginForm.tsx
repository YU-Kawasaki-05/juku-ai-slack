/** @file
 * 機能: ログインフォーム（Supabase Auth。エラー時は入力保持・パスワードのみクリア）
 * 例外: 認証拒否とネットワーク/サーバー障害でメッセージを出し分ける（E-8）
 * @implements FR-13
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2 } from 'lucide-react'
import { getBrowserClient } from '@/shared/lib/supabase/browserClient'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const CREDENTIAL_ERROR_MESSAGE = 'メールアドレスまたはパスワードが正しくありません。'
export const TRANSIENT_ERROR_MESSAGE =
  'ログイン処理でエラーが発生しました。時間をおいて再度お試しください。'

/** 判定に使う最小形（Supabase の AuthError / AuthRetryableFetchError いずれも満たす） */
export interface LoginAuthError {
  code?: string
  status?: number
  name?: string
}

/** 「入力が誤っている」と断定してよい Supabase Auth のエラーコード */
const CREDENTIAL_ERROR_CODES = new Set([
  'invalid_credentials',
  'invalid_grant',
  'user_not_found',
  'validation_failed',
])

/**
 * 認証拒否（入力ミス）と一時障害（ネットワーク・レート制限・5xx）を切り分ける。
 * ネットワーク断は AuthRetryableFetchError（status=0）として届くため、
 * 全部を「認証失敗」にすると原因が誤誘導される（E2E の偽陽性の原因でもあった）。
 */
export function toLoginErrorMessage(authError: LoginAuthError): string {
  if (authError.code && CREDENTIAL_ERROR_CODES.has(authError.code)) {
    return CREDENTIAL_ERROR_MESSAGE
  }
  if (authError.code) {
    // rate limit / メール未確認 / サーバー設定など、入力を直しても解決しない種別
    return TRANSIENT_ERROR_MESSAGE
  }
  // code を持たない旧バージョン向けのフォールバック: 400/401/403 のみ認証拒否とみなす
  const status = authError.status
  if (status === 400 || status === 401 || status === 403) {
    return CREDENTIAL_ERROR_MESSAGE
  }
  return TRANSIENT_ERROR_MESSAGE
}

export default function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = getBrowserClient()
    // fetch 自体が throw するケース（オフライン等）も一時障害として扱う
    const authError: LoginAuthError | null = await supabase.auth
      .signInWithPassword({ email, password })
      .then((r) => r.error)
      .catch(() => ({ name: 'NetworkError', status: 0 }))

    if (authError) {
      setError(toLoginErrorMessage(authError))
      setPassword('')
      setLoading(false)
      return
    }

    router.push('/admin')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">メールアドレス</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">パスワード</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {loading ? 'ログイン中...' : 'ログイン'}
      </Button>
    </form>
  )
}
