/** @file
 * 機能: チャンネル紐付け 新規作成（SCR-06）
 * @implements FR-15, AC-15-01
 */
import type { Metadata } from 'next'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getPersons } from '@features/persons'
import { BindingForm } from '@features/channel-bindings/components/BindingForm'

export const metadata: Metadata = { title: '新規チャンネル紐付け' }

export default async function NewBindingPage() {
  const persons = await getPersons(createServerClient())

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">新規チャンネル紐付け</h1>
        <p className="text-sm text-muted-foreground">
          Slack チャンネルと生徒を対応付けて、Bot が反応できるようにします
        </p>
      </div>
      <BindingForm persons={persons.map((p) => ({ id: p.id, name: p.name }))} />
    </div>
  )
}
