'use client'

import { useRouter } from 'next/navigation'
import { getBrowserClient } from '@/shared/lib/supabase/browserClient'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'

interface Props {
  email: string
}

export default function AdminHeaderClient({ email }: Props) {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = getBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div />
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{email}</span>
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          <LogOut className="h-4 w-4" />
          ログアウト
        </Button>
      </div>
    </header>
  )
}
