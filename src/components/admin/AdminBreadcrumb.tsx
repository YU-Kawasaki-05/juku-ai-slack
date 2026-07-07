/** @file
 * 機能: 管理画面のパンくずリスト（URL セグメントから階層を組み立てる）
 * @implements FR-13（SCR 共通レイアウト）
 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

const SEGMENT_LABELS: Record<string, string> = {
  persons: '生徒管理',
  channels: 'チャンネル紐付け',
  reports: 'レポート',
  errors: 'エラーログ',
  new: '新規作成',
  edit: '編集',
}

export default function AdminBreadcrumb() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'admin') return null

  const crumbs = [{ href: '/admin', label: 'ダッシュボード' }]
  let path = '/admin'
  for (const segment of segments.slice(1)) {
    path += `/${segment}`
    // 既知セグメント以外は動的な id（詳細・編集ページ）とみなす
    crumbs.push({ href: path, label: SEGMENT_LABELS[segment] ?? '詳細・編集' })
  }

  return (
    <nav aria-label="パンくずリスト" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                  aria-hidden="true"
                />
              )}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
