/** @file
 * 機能: 利用状況チャート群（SCR-10 / FR-18）。日別質問数・日別コスト・モデル別・生徒別・エラーコード別
 * デザイン: dataviz スキル準拠。全チャート単色（検証済み --viz-1）。時系列は 2px 線 + 淡い塗り
 *   でツールチップ、カテゴリは横棒 + 値の直接ラベル（contrast relief）。グリッド/軸は recessive。
 *   色は CSS 変数参照で light/dark 自動対応
 * @implements FR-18
 */
'use client'

import { useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, BarChart3, TrendingUp, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { UsageAnalytics } from '../lib/getUsageAnalytics'

const VIZ = 'var(--viz-1)'
const AXIS_TICK = { fill: 'hsl(var(--muted-foreground))', fontSize: 12 }

/** 同じ数値をグラフと表で切り替えられる（dataviz: SR / 印刷 / CVD 向けの table view） */
function ChartCard({
  title,
  icon: Icon,
  description,
  children,
  table,
}: {
  title: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  description?: string
  children: React.ReactNode
  table?: React.ReactNode
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden={true} />
            {title}
          </CardTitle>
          {table && (
            <div
              role="group"
              aria-label={`${title}の表示切替`}
              className="inline-flex shrink-0 rounded-md border bg-card p-0.5 text-xs"
            >
              {(['chart', 'table'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'rounded px-2 py-0.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    view === v
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v === 'chart' ? 'グラフ' : '表'}
                </button>
              ))}
            </div>
          )}
        </div>
        {description && <p className="text-xs text-muted-foreground/80">{description}</p>}
      </CardHeader>
      <CardContent>{view === 'table' && table ? table : children}</CardContent>
    </Card>
  )
}

/** チャートと同じ数値の表。最後の numericFrom 列以降を右寄せ・tabular-nums にする */
function DataTable({
  caption,
  headers,
  rows,
  numericFrom = 1,
}: {
  caption: string
  headers: string[]
  rows: (string | number)[][]
  numericFrom?: number
}) {
  return (
    <div className="max-h-[260px] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  'px-3 py-1.5 font-medium text-muted-foreground',
                  i >= numericFrom ? 'text-right' : 'text-left',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t">
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={cn('px-3 py-1.5', ci >= numericFrom && 'text-right tabular-nums')}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface TooltipRow {
  value?: number | string
  payload?: Record<string, unknown>
}

function TooltipBox({ heading, lines }: { heading?: string; lines: string[] }) {
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      {heading && <div className="mb-1 font-medium text-popover-foreground">{heading}</div>}
      {lines.map((line, i) => (
        <div key={i} className="tabular-nums text-popover-foreground">
          {line}
        </div>
      ))}
    </div>
  )
}

function formatUsd(v: number): string {
  return `$${v.toFixed(v < 1 ? 4 : 2)}`
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

export function UsageCharts({ analytics }: { analytics: UsageAnalytics }) {
  const { daily, byModel, byPerson, errorsByCode } = analytics

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="日別 質問数"
          icon={TrendingUp}
          description="生徒からの質問件数の推移"
          table={
            <DataTable
              caption="日別の質問数"
              headers={['日付', '質問数']}
              rows={daily.map((d) => [d.label, d.count])}
            />
          }
        >
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: 'var(--viz-axis)' }}
                minTickGap={24}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={36}
              />
              <Tooltip
                cursor={{ stroke: 'var(--viz-axis)' }}
                content={(props) => {
                  const p = props.payload?.[0] as TooltipRow | undefined
                  if (!props.active || !p) return null
                  return <TooltipBox heading={String(props.label)} lines={[`質問数 ${p.value} 件`]} />
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke={VIZ}
                strokeWidth={2}
                fill={VIZ}
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="日別 コスト"
          icon={TrendingUp}
          description="AI API の推定利用額（USD）"
          table={
            <DataTable
              caption="日別のコスト"
              headers={['日付', 'コスト']}
              rows={daily.map((d) => [d.label, formatUsd(d.costUsd)])}
            />
          }
        >
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={daily} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: 'var(--viz-axis)' }}
                minTickGap={24}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v: number) => formatUsd(v)}
              />
              <Tooltip
                cursor={{ stroke: 'var(--viz-axis)' }}
                content={(props) => {
                  const p = props.payload?.[0] as TooltipRow | undefined
                  if (!props.active || !p) return null
                  return (
                    <TooltipBox
                      heading={String(props.label)}
                      lines={[`コスト ${formatUsd(Number(p.value ?? 0))}`]}
                    />
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="costUsd"
                stroke={VIZ}
                strokeWidth={2}
                fill={VIZ}
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="モデル別 利用回数"
          icon={BarChart3}
          table={
            <DataTable
              caption="モデル別の利用回数とコスト"
              headers={['モデル', '回数', 'コスト']}
              rows={byModel.map((m) => [m.model, m.count, formatUsd(m.costUsd)])}
            />
          }
        >
          {byModel.length === 0 ? (
            <EmptyChart message="この期間の利用はありません" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, byModel.length * 48)}>
              <BarChart
                data={byModel}
                layout="vertical"
                margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
              >
                <CartesianGrid stroke="var(--viz-grid)" horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="model"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={140}
                />
                <Tooltip
                  cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.4 }}
                  content={(props) => {
                    const row = props.payload?.[0]?.payload as
                      | { model: string; count: number; costUsd: number }
                      | undefined
                    if (!props.active || !row) return null
                    return (
                      <TooltipBox
                        heading={row.model}
                        lines={[`利用 ${row.count} 回`, `コスト ${formatUsd(row.costUsd)}`]}
                      />
                    )
                  }}
                />
                <Bar dataKey="count" fill={VIZ} radius={[0, 4, 4, 0]} barSize={20}>
                  <LabelList
                    dataKey="count"
                    position="right"
                    className="fill-foreground"
                    style={{ fontSize: 12 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="生徒別 質問数（上位10）"
          icon={Users}
          table={
            <DataTable
              caption="生徒別の質問数（上位10）"
              headers={['生徒', '質問数']}
              rows={byPerson.map((p) => [p.name, p.count])}
            />
          }
        >
          {byPerson.length === 0 ? (
            <EmptyChart message="この期間の利用はありません" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, byPerson.length * 36)}>
              <BarChart
                data={byPerson}
                layout="vertical"
                margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
              >
                <CartesianGrid stroke="var(--viz-grid)" horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip
                  cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.4 }}
                  content={(props) => {
                    const row = props.payload?.[0]?.payload as
                      | { name: string; count: number }
                      | undefined
                    if (!props.active || !row) return null
                    return <TooltipBox heading={row.name} lines={[`質問 ${row.count} 件`]} />
                  }}
                />
                <Bar dataKey="count" fill={VIZ} radius={[0, 4, 4, 0]} barSize={16}>
                  <LabelList
                    dataKey="count"
                    position="right"
                    className="fill-foreground"
                    style={{ fontSize: 12 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {errorsByCode.length > 0 && (
        <ChartCard
          title="エラーコード別 発生数"
          icon={AlertTriangle}
          description="この期間に記録されたエラーの内訳"
          table={
            <DataTable
              caption="エラーコード別の発生数"
              headers={['エラーコード', '件数']}
              rows={errorsByCode.map((e) => [e.code, e.count])}
            />
          }
        >
          <ResponsiveContainer width="100%" height={Math.max(120, errorsByCode.length * 40)}>
            <BarChart
              data={errorsByCode}
              layout="vertical"
              margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
            >
              <CartesianGrid stroke="var(--viz-grid)" horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="code"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={200}
              />
              <Tooltip
                cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.4 }}
                content={(props) => {
                  const row = props.payload?.[0]?.payload as
                    | { code: string; count: number }
                    | undefined
                  if (!props.active || !row) return null
                  return <TooltipBox heading={row.code} lines={[`${row.count} 件`]} />
                }}
              />
              <Bar dataKey="count" fill={VIZ} radius={[0, 4, 4, 0]} barSize={18}>
                <LabelList
                  dataKey="count"
                  position="right"
                  className="fill-foreground"
                  style={{ fontSize: 12 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  )
}
