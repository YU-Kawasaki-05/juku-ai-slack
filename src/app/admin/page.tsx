import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createServerClient } from '@/shared/lib/supabase/serverClient'

export default async function AdminDashboardPage() {
  const supabase = createServerClient()

  const [{ count: studentCount }, { count: reportCount }, { count: pendingJobCount }] =
    await Promise.all([
      supabase.from('persons').select('*', { count: 'exact', head: true }),
      supabase.from('reports').select('*', { count: 'exact', head: true }),
      supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">ダッシュボード</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">生徒数</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{studentCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">レポート数</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{reportCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              ペンディングジョブ
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingJobCount ?? 0}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
