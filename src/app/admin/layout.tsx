import type { Metadata } from 'next'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminHeader from '@/components/admin/AdminHeader'
import { Toaster } from '@/components/ui/toaster'

export const metadata: Metadata = {
  title: {
    template: '%s | じゅくAI 管理画面',
    default: '管理画面 | じゅくAI',
  },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow focus:ring-2 focus:ring-ring"
      >
        メインコンテンツへスキップ
      </a>
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main id="admin-main" tabIndex={-1} className="flex-1 overflow-y-auto p-6 focus:outline-none">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <Toaster />
    </div>
  )
}
