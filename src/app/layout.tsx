import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'じゅくAI 管理画面',
  description: 'じゅくAI Slack Bot 管理ダッシュボード',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
