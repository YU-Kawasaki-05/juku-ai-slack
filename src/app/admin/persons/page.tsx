/** @file
 * 機能: 生徒一覧（SCR-03）
 * @implements FR-14, AC-14-01
 */
import Link from 'next/link'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getPersons } from '@features/persons'
import { Button } from '@/components/ui/button'

export default async function PersonsPage() {
  const persons = await getPersons(createServerClient())

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">生徒管理</h1>
        <Button asChild>
          <Link href="/admin/persons/new">新規生徒</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">名前</th>
              <th className="px-4 py-2 font-medium">学年</th>
              <th className="px-4 py-2 font-medium">ステータス</th>
              <th className="px-4 py-2 font-medium">保護者メール</th>
            </tr>
          </thead>
          <tbody>
            {persons.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  生徒がまだ登録されていません
                </td>
              </tr>
            )}
            {persons.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-accent/50">
                <td className="px-4 py-2">
                  <Link href={`/admin/persons/${p.id}`} className="font-medium text-primary hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{p.grade ?? '-'}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      p.status === 'active'
                        ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700'
                        : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600'
                    }
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{p.guardian_email ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
