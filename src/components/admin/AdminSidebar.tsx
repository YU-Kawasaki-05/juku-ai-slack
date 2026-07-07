/** @file
 * 機能: 管理画面サイドバー（現在地ハイライト付きナビゲーション）
 * @implements FR-13（SCR 共通レイアウト）
 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  FileText,
  Link2,
  AlertCircle,
  BarChart3,
  GraduationCap,
  MessagesSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/admin/persons', label: '生徒管理', icon: Users },
  { href: '/admin/channels', label: 'チャンネル設定', icon: Link2 },
  { href: '/admin/reports', label: 'レポート', icon: FileText },
  { href: '/admin/conversations', label: '会話ログ', icon: MessagesSquare },
  { href: '/admin/errors', label: 'エラーログ', icon: AlertCircle },
  { href: '/admin/usage', label: '利用状況', icon: BarChart3 },
]

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <GraduationCap className="h-5 w-5 text-sidebar-primary" aria-hidden="true" />
        <span className="font-bold text-sidebar-primary">じゅくAI</span>
      </div>
      <nav aria-label="メインナビゲーション" className="flex-1 space-y-1 overflow-y-auto p-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring',
                active
                  ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
