/** @file
 * 機能: チャンネル紐付け 編集（status 切替で Bot 反応の有効/無効, AC-15-02）
 * @implements FR-15, AC-15-02
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getBinding } from '@features/channel-bindings'
import { BindingEditForm } from '@features/channel-bindings/components/BindingEditForm'

export const metadata: Metadata = { title: 'チャンネル紐付けの編集' }

export default async function BindingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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
