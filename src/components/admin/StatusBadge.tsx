/** @file
 * 機能: ステータスの共通バッジ（日本語ラベル + ドット。色だけに依存しない視覚表現）
 * システム全体のステータス語彙 → 表示の辞書をここで一元管理する
 * @implements FR-14, FR-15, FR-16, FR-17（SCR-03/05/07/11 の状態表示）
 */
import { cn } from '@/lib/utils'

const emerald = {
  dot: 'bg-emerald-500',
  badge:
    'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/30',
}
const slate = {
  dot: 'bg-slate-400',
  badge:
    'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-400/30',
}
const amber = {
  dot: 'bg-amber-500',
  badge:
    'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/30',
}
const blue = {
  dot: 'bg-blue-500',
  badge:
    'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/30',
}
const red = {
  dot: 'bg-red-500',
  badge:
    'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30',
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  // persons / channel-bindings（FR-14/15）
  active: { label: '有効', ...emerald },
  inactive: { label: '無効', ...slate },
  // reports（FR-16。approved/sent が RAG の AI 参照候補）
  ai_draft: { label: 'AI下書き', ...amber },
  draft: { label: '下書き', ...slate },
  approved: { label: '承認済み', ...emerald },
  sent: { label: '送信済み', ...blue },
  // ai_error_logs の severity（FR-17）
  error: { label: 'エラー', ...red },
  warning: { label: '警告', ...amber },
  info: { label: '情報', ...slate },
  // ai_error_logs の対応状況（FR-17）
  resolved: { label: '対応済み', ...emerald },
  unresolved: { label: '未対応', ...amber },
}

// 未知の status は生の値のまま中立色で表示する（enum 追加時に UI が壊れないように）
const FALLBACK = STATUS_CONFIG.inactive

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const config = STATUS_CONFIG[status] ?? { ...FALLBACK, label: status }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        config.badge,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', config.dot)} aria-hidden="true" />
      {config.label}
    </span>
  )
}
