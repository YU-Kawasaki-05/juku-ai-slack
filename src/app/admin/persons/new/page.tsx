/** @file
 * 機能: 生徒 新規登録（SCR-04 の新規モード）
 * @implements FR-14, AC-14-02
 */
import { createPersonAction } from '@features/persons'
import { PersonForm } from '@features/persons/components/PersonForm'

export default function NewPersonPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">新規生徒</h1>
      <PersonForm action={createPersonAction} />
    </div>
  )
}
