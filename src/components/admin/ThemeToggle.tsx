/** @file
 * 機能: テーマ切替（ライト / ダーク / システム）。localStorage の `theme` と html.dark を同期する
 * @implements FR-13（SCR 共通レイアウト）
 */
'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type Theme = 'light' | 'dark' | 'system'

function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export default function ThemeToggle() {
  // SSR とのミスマッチを避けるためマウント後に localStorage から読む
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark') setTheme(stored)

    // システム追従中に OS 設定が変わったら追随する
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (!localStorage.getItem('theme')) applyTheme('system')
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  function handleChange(value: string) {
    const next = value as Theme
    setTheme(next)
    if (next === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', next)
    applyTheme(next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="テーマを切り替える">
          <Sun className="h-4 w-4 dark:hidden" aria-hidden="true" />
          <Moon className="hidden h-4 w-4 dark:block" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={handleChange}>
          <DropdownMenuRadioItem value="light">ライト</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">ダーク</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">システム設定に従う</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
