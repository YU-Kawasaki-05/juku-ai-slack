/** @file
 * 機能: 生徒 詳細・編集（SCR-04 基本情報）
 * @implements FR-14, AC-14-02
 */
import { notFound } from 'next/navigation'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getPerson, updatePersonAction } from '@features/persons'
import { PersonForm } from '@features/persons/components/PersonForm'

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const person = await getPerson(createServerClient(), id)
  if (!person) notFound()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{person.name}</h1>
      <PersonForm action={updatePersonAction} person={person} />
    </div>
  )
}
