/** @file
 * 機能: チャンネル紐付け画面（SCR-05/06）を admin 限定にするガードと、staff 向けの案内表示
 * 入力: なし（Cookie セッション）
 * 出力: hasChannelAdminAccess() = admin か / ChannelAdminOnlyNotice = 権限が無い旨の案内
 * 依存: requireAdmin
 * セキュリティ: チャンネル紐付けは admin 専用（権限設計 EP-07〜09）。Server Action は
 *   requireAdmin で守られていたが画面は staff でも開けていたため、生徒名とチャンネルの
 *   対応表が staff に見え、フォームも「保存して初めて拒否される」導線になっていた。
 *   多層防御としてページ側でも admin を要求し、権限が無い場合はデータを一切読まない
 * UX: /admin/no-access は「ロール未設定」の案内で、role を持つ staff が開くと /admin へ
 *   戻されるため、そこへ送るとリダイレクトが往復して理由が伝わらない。画面内で理由を出す
 * @implements FR-13, FR-15
 */
import 'server-only'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { requireAdmin } from '@shared/lib/auth/requireAdmin'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export async function hasChannelAdminAccess(): Promise<boolean> {
  try {
    await requireAdmin()
    return true
  } catch (e) {
    // 未認証（セッション切れ）に案内文を出しても解決しない。layout と同じく再ログインへ倒す
    if ((e as Error)?.message !== 'forbidden') redirect('/login')
    return false
  }
}

export function ChannelAdminOnlyNotice() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">チャンネル紐付け</h1>
      <Alert variant="warning">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        <AlertDescription>
          チャンネル紐付けの管理は管理者（admin）のみが利用できます。
          追加・変更が必要な場合は管理者に依頼してください
        </AlertDescription>
      </Alert>
      <Button variant="outline" asChild>
        <Link href="/admin">ダッシュボードへ戻る</Link>
      </Button>
    </div>
  )
}
