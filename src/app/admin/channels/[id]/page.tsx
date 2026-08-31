/** @file
 * 機能: チャンネル紐付け 編集（status 切替で Bot 反応の有効/無効, AC-15-02）
 * @implements FR-15, AC-15-02
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getBinding } from '@features/channel-bindings'
import { BindingEditForm } from '@features/channel-bindings/components/BindingEditForm'
import { isUuid } from '../../searchParams'
import { ChannelAdminOnlyNotice, hasChannelAdminAccess } from '../adminOnly'

export const metadata: Metadata = { title: 'チャンネル紐付けの編集' }

export default async function BindingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // EP-07: admin 限定。存在判定より先に弾く（404 かどうかも権限が無い相手には返さない）
  if (!(await hasChannelAdminAccess())) return <ChannelAdminOnlyNotice />
  // UUID でない ID をそのままクエリすると Postgres 22P02 で 500 になるため事前に 404 に倒す（H-5）
  if (!isUuid(id)) notFound()
  const binding = await getBinding(createServerClient(), id)
  if (!binding) notFound()

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">チャンネル紐付けの編集</h1>
        <p className="text-sm text-muted-foreground">
          表示名の変更と、Bot 反応の有効/無効を切り替えられます
        </p>
      </div>
      <BindingEditForm binding={binding} />
    </div>
  )
}
