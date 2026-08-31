/** @file
 * 機能: ログインはできているが app_metadata.role が未設定のユーザーへの案内（SCR-01 の派生）
 * 入力: なし（Cookie セッション）
 * 出力: 権限がない旨の説明 + 管理者向けの対処 + ログアウト導線
 * 依存: createAuthServerClient, NoAccessSignOutButton
 * 配置: **ルートグループ `(no-shell)` に置いて `src/app/admin/layout.tsx` の配下から外している**。
 *   同レイアウトは requireStaffPage() でこのパスへリダイレクトするため、
 *   配下に置くと「リダイレクト先で再びリダイレクト」の無限ループになる。
 *   middleware（matcher: /admin/:path*）は未ログインのみ /login に倒すので、
 *   ログイン済みのこのページはそのまま通る
 * セキュリティ: ロールを持つユーザーがここに迷い込んだら /admin へ戻す。
 *   判定は app_metadata のみ（user_metadata は本人が書き換えられる）
 * @implements FR-13
 */
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { createAuthServerClient } from '@/shared/lib/supabase/authServerClient'
import { Alert, AlertDescription } from '@/components/ui/alert'
import NoAccessSignOutButton from './NoAccessSignOutButton'

export const metadata: Metadata = {
  title: '管理画面の利用権限がありません | じゅくAI',
}

const GRANT_ROLE_SQL = `update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role":"staff"}'::jsonb
where email = '<対象のメールアドレス>';`

export default async function NoAccessPage() {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  const role: unknown = user.app_metadata?.role
  if (role === 'staff' || role === 'admin') redirect('/admin')

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <main className="w-full max-w-xl space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight">
              このアカウントには管理画面の利用権限が設定されていません
            </h1>
            <p className="text-sm text-muted-foreground">
              ログインは成功していますが、ロール（staff / admin）が付与されていないため
              生徒情報などを表示できません
            </p>
          </div>
        </div>

        <Alert variant="warning">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>
            <span className="text-xs">ログイン中のアカウント</span>
            <br />
            <span className="font-medium break-all">{user.email ?? '（メールアドレス不明）'}</span>
          </AlertDescription>
        </Alert>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">管理者の方へ: 権限の付け方</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Supabase の <b>SQL Editor</b> で、対象ユーザーの{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">app_metadata.role</code> に{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">staff</code> か{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">admin</code> を設定する
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs text-foreground">
                <code>{GRANT_ROLE_SQL}</code>
              </pre>
            </li>
            <li>
              ロールは JWT に埋め込まれるため、付与後に必ず
              <b>ログアウト → 再ログイン</b>する（既存セッションには反映されない）
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1 py-0.5">user_metadata</code>{' '}
            ではなく <code className="rounded bg-muted px-1 py-0.5">app_metadata</code>{' '}
            です。user_metadata は本人が書き換えられるため権限判定には使いません。
          </p>
        </section>

        <NoAccessSignOutButton />
      </main>
    </div>
  )
}
