/** @file
 * 機能: 利用状況チャート群（SCR-10 / FR-18）。日別質問数・日別コスト・モデル別・生徒別・エラーコード別
 * デザイン: dataviz スキル準拠。全チャート単色（検証済み --viz-1）。時系列は 2px 線 + 淡い塗り
 *   でツールチップ、カテゴリは横棒 + 値の直接ラベル（contrast relief）。グリッド/軸は recessive。
 *   色は CSS 変数参照で light/dark 自動対応
 * @implements FR-18
 */
'use client'

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
import type { UsageAnalytics } from '../lib/getUsageAnalytics'

const VIZ = 'var(--viz-1)'
const AXIS_TICK = { fill: 'hsl(var(--muted-foreground))', fontSize: 12 }

function ChartCard({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden={true} />
          {title}
        </CardTitle>
        {description && <p className="text-xs text-muted-foreground/80">{description}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
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
        <ChartCard title="日別 質問数" icon={TrendingUp} description="生徒からの質問件数の推移">
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

        <ChartCard title="日別 コスト" icon={TrendingUp} description="AI API の推定利用額（USD）">
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
        <ChartCard title="モデル別 利用回数" icon={BarChart3}>
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

        <ChartCard title="生徒別 質問数（上位10）" icon={Users}>
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
