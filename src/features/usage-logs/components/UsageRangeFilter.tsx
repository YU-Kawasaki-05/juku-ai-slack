/** @file
 * 機能: 利用状況の期間フィルタ（直近 7 / 30 / 90 日）。URL クエリと同期し SSR で集計
 * @implements FR-18（SCR-10）
 */
'use client'

import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { USAGE_RANGES, type UsageRangeDays } from '../lib/getUsageAnalytics'

export function UsageRangeFilter({ value }: { value: UsageRangeDays }) {
  const router = useRouter()

  return (
    <div
      role="group"
      aria-label="集計期間"
      className="inline-flex items-center rounded-md border bg-card p-0.5"
    >
      {USAGE_RANGES.map((days) => {
        const active = days === value
        return (
          <button
            key={days}
            type="button"
            aria-pressed={active}
            onClick={() => router.replace(days === 30 ? '/admin/usage' : `/admin/usage?range=${days}`)}
            className={cn(
              'rounded px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {days}日
          </button>
        )
      })}
    </div>
  )
}
