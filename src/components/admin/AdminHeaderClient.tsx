/** @file
 * 機能: 管理画面ヘッダー（パンくず + テーマ切替 + ユーザーメニュー/ログアウト）
 * @implements FR-13（SCR 共通レイアウト）
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserClient } from '@/shared/lib/supabase/browserClient'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, CircleUserRound, LogOut } from 'lucide-react'
import AdminBreadcrumb from './AdminBreadcrumb'
import ThemeToggle from './ThemeToggle'

interface Props {
  email: string
}

export default function AdminHeaderClient({ email }: Props) {
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
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background px-6">
      <AdminBreadcrumb />
      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 font-normal">
              <CircleUserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="max-w-[14rem] truncate text-muted-foreground">
                {email || 'アカウント'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <p className="text-xs text-muted-foreground">ログイン中のアカウント</p>
              <p className="truncate text-sm font-medium">{email || '不明'}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut} disabled={signingOut}>
              <LogOut aria-hidden="true" />
              {signingOut ? 'ログアウト中...' : 'ログアウト'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
