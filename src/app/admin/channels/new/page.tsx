/** @file
 * 機能: チャンネル紐付け 新規作成（SCR-06）
 * @implements FR-15, AC-15-01
 */
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getPersons } from '@features/persons'
import { BindingForm } from '@features/channel-bindings/components/BindingForm'

export default async function NewBindingPage() {
  const persons = await getPersons(createServerClient())

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">新規チャンネル紐付け</h1>
      <BindingForm persons={persons.map((p) => ({ id: p.id, name: p.name }))} />
    </div>
  )
}
