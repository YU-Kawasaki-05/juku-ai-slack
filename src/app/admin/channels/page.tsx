/** @file
 * 機能: チャンネル紐付け一覧（SCR-05）
 * @implements FR-15
 */
import Link from 'next/link'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getBindings } from '@features/channel-bindings'
import { Button } from '@/components/ui/button'

export default async function ChannelsPage() {
  const bindings = await getBindings(createServerClient())

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">チャンネル紐付け</h1>
        <Button asChild>
          <Link href="/admin/channels/new">新規紐付け</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">チャンネル</th>
              <th className="px-4 py-2 font-medium">チャンネルID</th>
              <th className="px-4 py-2 font-medium">生徒</th>
              <th className="px-4 py-2 font-medium">ステータス</th>
            </tr>
          </thead>
          <tbody>
            {bindings.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  紐付けがまだありません
                </td>
              </tr>
            )}
            {bindings.map((b) => (
              <tr key={b.id} className="border-b last:border-0 hover:bg-accent/50">
                <td className="px-4 py-2">{b.slack_channel_name ?? '-'}</td>
                <td className="px-4 py-2 font-mono text-xs">{b.slack_channel_id}</td>
                <td className="px-4 py-2">{b.persons?.name ?? b.person_name_snapshot ?? '-'}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      b.status === 'active'
                        ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700'
                        : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600'
                    }
                  >
                    {b.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
