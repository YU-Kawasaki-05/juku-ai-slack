/** @file
 * 機能: 利用状況ダッシュボード（SCR-10 / FR-18）。期間フィルタ + サマリー + チャート群
 * @implements FR-18
 */
import type { Metadata } from 'next'
import { CircleDollarSign, ImageIcon, MessageCircleQuestion, Coins } from 'lucide-react'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getUsageAnalytics, USAGE_RANGES, type UsageRangeDays } from '@features/usage-logs'
import { UsageCharts } from '@features/usage-logs/components/UsageCharts'
import { UsageRangeFilter } from '@features/usage-logs/components/UsageRangeFilter'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = { title: '利用状況' }

function parseRange(raw: string | undefined): UsageRangeDays {
  const n = Number(raw)
  return (USAGE_RANGES as readonly number[]).includes(n) ? (n as UsageRangeDays) : 30
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const { range } = await searchParams
  const days = parseRange(range)
  const analytics = await getUsageAnalytics(createServerClient(), days)
  const { totals } = analytics

  const tiles = [
    {
      label: '質問数',
      value: totals.questionCount.toLocaleString('ja-JP'),
      hint: `直近${days}日`,
      icon: MessageCircleQuestion,
    },
    {
      label: 'コスト',
      value: `$${totals.costUsd.toFixed(totals.costUsd < 1 ? 4 : 2)}`,
      hint: 'AI API 推定利用額',
      icon: CircleDollarSign,
    },
    {
      label: '総トークン',
      value: formatTokens(totals.totalTokens),
      hint: `入力 ${formatTokens(totals.inputTokens)} / 出力 ${formatTokens(totals.outputTokens)}`,
      icon: Coins,
    },
    {
      label: '画像付き質問',
      value: totals.imageCount.toLocaleString('ja-JP'),
      hint: `全体の ${totals.questionCount > 0 ? Math.round((totals.imageCount / totals.questionCount) * 100) : 0}%`,
      icon: ImageIcon,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">利用状況</h1>
          <p className="text-sm text-muted-foreground">
            AI 利用量・コスト・エラーの推移（日本時間で集計）
          </p>
        </div>
        <UsageRangeFilter value={days} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
              <t.icon className="h-4 w-4 text-muted-foreground/70" aria-hidden={true} />
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-3xl font-bold tabular-nums">{t.value}</p>
              <p className="text-xs text-muted-foreground">{t.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <UsageCharts analytics={analytics} />
    </div>
  )
}
