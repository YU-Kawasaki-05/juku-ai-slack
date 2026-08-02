/** @file
 * 機能: 権限なし画面のログアウトボタン（別アカウントで入り直せるようにするため）
 * 依存: getBrowserClient
 * 備考: AdminHeaderClient と同じ signOut → /login。この画面は管理画面シェルの外にあり
 *   ヘッダーのユーザーメニューが無いので、ここに単独で置く
 * @implements FR-13
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { getBrowserClient } from '@/shared/lib/supabase/browserClient'
import { Button } from '@/components/ui/button'

export default function NoAccessSignOutButton() {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    const supabase = getBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <Button variant="outline" className="w-full" onClick={handleSignOut} disabled={signingOut}>
      <LogOut className="h-4 w-4" aria-hidden="true" />
      {signingOut ? 'ログアウト中...' : 'ログアウトして別のアカウントでログイン'}
    </Button>
  )
}
