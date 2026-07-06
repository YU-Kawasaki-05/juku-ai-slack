/** @file
 * 機能: チャンネル紐付け 編集（status 切替で Bot 反応の有効/無効, AC-15-02）
 * @implements FR-15, AC-15-02
 */
import { notFound } from 'next/navigation'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getBinding } from '@features/channel-bindings'
import { BindingEditForm } from '@features/channel-bindings/components/BindingEditForm'

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
      <h1 className="text-2xl font-bold">チャンネル紐付けの編集</h1>
      <BindingEditForm binding={binding} />
    </div>
  )
}
