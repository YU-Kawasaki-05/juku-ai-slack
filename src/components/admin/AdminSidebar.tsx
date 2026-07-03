import Link from 'next/link'
import { LayoutDashboard, Users, FileText, Link2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/admin/students', label: '生徒管理', icon: Users },
  { href: '/admin/reports', label: 'レポート', icon: FileText },
  { href: '/admin/channels', label: 'チャンネル設定', icon: Link2 },
  { href: '/admin/errors', label: 'エラーログ', icon: AlertCircle },
]

export default function AdminSidebar() {
  return (
    <aside className="flex w-56 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <span className="font-bold text-primary">じゅくAI</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
