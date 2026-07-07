/** @file
 * 機能: 生徒 新規登録（SCR-04 の新規モード）
 * @implements FR-14, AC-14-02
 */
import type { Metadata } from 'next'
import { createPersonAction } from '@features/persons'
import { PersonForm } from '@features/persons/components/PersonForm'

export const metadata: Metadata = { title: '新規生徒' }

export default function NewPersonPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">新規生徒</h1>
        <p className="text-sm text-muted-foreground">Bot を利用する生徒を登録します</p>
      </div>
      <PersonForm action={createPersonAction} />
    </div>
  )
}
