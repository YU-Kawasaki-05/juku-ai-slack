import type { Metadata } from 'next'
import './globals.css'
import { APP_NAME } from '@/shared/lib/constants'

export const metadata: Metadata = {
  title: `${APP_NAME} 管理画面`,
  description: `${APP_NAME} Slack Bot 管理ダッシュボード`,
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
