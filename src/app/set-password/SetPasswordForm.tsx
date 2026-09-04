/** @file
 * 機能: 招待リンク（Supabase recovery リンク）で開いた本人がパスワードを自分で設定する
 * 入力: URL フラグメント `#access_token=...&refresh_token=...&type=recovery`
 *   （失敗時は `#error=access_denied&error_code=otp_expired&...`）
 * 出力: パスワード設定後 /admin へ遷移
 * 依存: getBrowserClient（@supabase/ssr の createBrowserClient。セッションは Cookie に保存される）
 * 例外: リンク不正・期限切れ・更新失敗をそれぞれ日本語で出し分ける
 * セキュリティ:
 *   ・このページは未認証で開ける（middleware の matcher に入れてはいけない。入れると
 *     リンクを開いた瞬間に /login へ飛ばされ、フラグメントも失われて二度と設定できない）
 *   ・パスワード変更はリンクで確立したセッションが無ければ実行できない。UI 側は
 *     status==='ready'（= setSession / 既存セッションの確認が成功）以外でフォームを出さず、
 *     送信直前にも getSession() を再確認する。最終的な強制は Supabase 側（PUT /auth/v1/user は
 *     Bearer トークン必須）なので、DOM を書き換えても他人のパスワードは変えられない
 *   ・access_token / refresh_token はクエリではなくフラグメントからのみ読む
 *     （クエリはサーバーログ・Referer に残る）。読み終えたら履歴から消す
 * @implements FR-13
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, KeyRound, Loader2 } from 'lucide-react'
import { getBrowserClient } from '@/shared/lib/supabase/browserClient'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  EXPIRED_LINK_MESSAGE,
  MIN_PASSWORD_LENGTH,
  NO_LINK_MESSAGE,
  SESSION_LOST_MESSAGE,
  parseRecoveryLink,
  toRecoveryLinkErrorMessage,
  toUpdatePasswordErrorMessage,
  validateNewPassword,
  type UpdatePasswordError,
} from './passwordSetup'

type Status = 'checking' | 'ready' | 'invalid'

export default function SetPasswordForm() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // React の StrictMode（next dev の既定）は effect を 2 回走らせる。1 回目でフラグメントを
  // 消すため 2 回目は「トークン無し」に見えてしまうので、実行を 1 回に固定する。
  // cleanup で非同期処理を中断してはいけない: StrictMode の「effect → cleanup → effect」では
  // 1 回目が中断され 2 回目はこのガードで何もしないため、画面が「確認中」で止まる
  const established = useRef(false)

  useEffect(() => {
    if (established.current) return
    established.current = true

    // フラグメントは createBrowserClient（detectSessionInUrl: true）が
    // 初期化時に読み取って消してしまうので、**クライアント生成より前に**同期で確保する
    const link = parseRecoveryLink(window.location.href)
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
    }

    void (async () => {
      if (link.kind === 'error') {
        setLinkError(toRecoveryLinkErrorMessage(link.errorCode))
        setStatus('invalid')
        return
      }

      const supabase = getBrowserClient()

      if (link.kind === 'tokens') {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: link.accessToken,
          refresh_token: link.refreshToken,
        })
        if (sessionError) {
          setLinkError(EXPIRED_LINK_MESSAGE)
          setStatus('invalid')
          return
        }
        setStatus('ready')
        return
      }

      // トークンが無い: 既にセッションがある（リロード等）なら続行、無ければ案内を出す
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        setStatus('ready')
        return
      }
      setLinkError(NO_LINK_MESSAGE)
      setStatus('invalid')
    })()
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)

      const invalidInput = validateNewPassword(password, confirmation)
      if (invalidInput) {
        setError(invalidInput)
        return
      }

      setSaving(true)
      const supabase = getBrowserClient()

      // 多層防御: フォームが出ている＝セッションがある前提だが、送信直前にも確認する
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        setError(SESSION_LOST_MESSAGE)
        setSaving(false)
        return
      }

      const authError: UpdatePasswordError | null = await supabase.auth
        .updateUser({ password })
        .then((r) => r.error)
        .catch(() => ({ name: 'NetworkError', status: 0 }))

      if (authError) {
        setError(toUpdatePasswordErrorMessage(authError))
        setPassword('')
        setConfirmation('')
        setSaving(false)
        return
      }

      router.push('/admin')
      router.refresh()
    },
    [password, confirmation, router],
  )

  if (status === 'checking') {
    return (
      <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        リンクを確認しています...
      </p>
    )
  }

  if (status === 'invalid') {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{linkError}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <a href="/login">ログイン画面へ</a>
        </Button>
      </div>
    )
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
        <Label htmlFor="password">新しいパスワード</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          aria-describedby="password-hint"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          {MIN_PASSWORD_LENGTH} 文字以上。使い回しは避けてください
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmation">新しいパスワード（確認）</Label>
        <Input
          id="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound className="h-4 w-4" aria-hidden="true" />
        )}
        {saving ? '設定中...' : 'パスワードを設定する'}
      </Button>
    </form>
  )
}
