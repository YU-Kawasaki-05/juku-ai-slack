/** @file
 * 機能: ダッシュボードの AI 応答状態カード（稼働中／停止中 + 理由 + 切替ボタン）。DEC-15
 * 備考: 管理者が停止状態に気づかず放置するのを防ぐため、ダッシュボード最上部に常時表示する
 * @implements DEC-15, FR-18
 */
import { CircleCheck, CircleSlash } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime } from '@/components/admin/formatDate'
import { cn } from '@/lib/utils'
import type { KillSwitchState } from '../lib/killSwitch'
import { KillSwitchToggle } from './KillSwitchToggle'

export function KillSwitchCard({ state }: { state: KillSwitchState }) {
  const { enabled } = state
  const Icon = enabled ? CircleCheck : CircleSlash

  return (
    <Card className={cn(!enabled && 'border-red-300 dark:border-red-900/60')}>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-6">
        <Icon
          className={cn('h-5 w-5 shrink-0', enabled ? 'text-emerald-500' : 'text-red-500')}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">AI応答</span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                enabled
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/30'
                  : 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30',
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  enabled ? 'bg-emerald-500' : 'bg-red-500',
                )}
                aria-hidden="true"
              />
              {enabled ? '稼働中' : '停止中'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? '生徒からの質問に AI が回答しています'
              : '生徒には「メンテナンス中」の定型文だけを返しています'}
          </p>
          {state.reason && (
            <p className="break-words text-xs text-muted-foreground">理由: {state.reason}</p>
          )}
          {state.updatedAt && (
            <p className="text-xs text-muted-foreground">
              最終更新: {formatDateTime(state.updatedAt)}
              {state.updatedBy ? `（${state.updatedBy}）` : ''}
            </p>
          )}
        </div>
        <KillSwitchToggle enabled={enabled} />
      </CardContent>
    </Card>
  )
}
