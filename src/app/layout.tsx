import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'じゅくAI 管理画面',
  description: 'じゅくAI Slack Bot 管理ダッシュボード',
}

// 描画前に localStorage / OS 設定からテーマを反映して FOUC を防ぐ
const themeInitScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
