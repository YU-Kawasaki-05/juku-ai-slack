/** @file
 * 機能: E2E がテストデータを直接作成・削除するための Service Role クライアント
 * 備考: RLS をバイパスするので **テストコード専用**。アプリ側からは import しない。
 *   各 spec は一意サフィックス付きのデータを作り、afterAll でここの helper を使って消す。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | undefined

export function adminDb(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('E2E: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return cached
}

/** spec ごとに衝突しない接尾辞。テスト名 + 時刻 + 乱数 */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export interface CreatedPerson {
  id: string
  name: string
}

export async function createPerson(name: string, grade = '中2'): Promise<CreatedPerson> {
  const { data, error } = await adminDb()
    .from('persons')
    .insert({ name, grade, status: 'active' })
    .select('id, name')
    .single()
  if (error || !data) throw new Error(`E2E: 生徒の作成に失敗 ${error?.message}`)
  return data as CreatedPerson
}

/**
 * 生徒とその従属データを消す。
 * report_chunks は reports の ON DELETE CASCADE、default_report_id は ON DELETE SET NULL
 * なので、reports → slack_channel_bindings → persons の順で足りる。
 * ai_error_logs.person_id は ON DELETE 指定が無い FK（migration 011）なので、
 * 残っていると persons の削除が黙って失敗しテストデータが溜まる。
 * 紐付けの作成・更新は操作ログ（CHANNEL_BINDING_CREATED/UPDATED）をここに書くため必ず消す。
 */
export async function deletePersons(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = adminDb()
  await db.from('reports').delete().in('person_id', ids)
  await db.from('slack_channel_bindings').delete().in('person_id', ids)
  await db.from('ai_error_logs').delete().in('person_id', ids)
  await db.from('persons').delete().in('id', ids)
}

export async function createReport(args: {
  personId: string
  title: string
  month: string
  status?: 'ai_draft' | 'draft' | 'approved' | 'sent'
}): Promise<{ id: string }> {
  const { data, error } = await adminDb()
    .from('reports')
    .insert({
      person_id: args.personId,
      title: args.title,
      report_month: args.month,
      body_markdown: '# E2E\n\n- テスト本文',
      status: args.status ?? 'draft',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`E2E: レポートの作成に失敗 ${error?.message}`)
  return data as { id: string }
}

/** 生徒名（完全一致）で消す。UI から作った生徒の後片付け用 */
export async function deletePersonsByName(names: string[]): Promise<void> {
  if (names.length === 0) return
  const { data } = await adminDb().from('persons').select('id').in('name', names)
  await deletePersons((data ?? []).map((p) => p.id as string))
}

export async function deleteBindingsByChannelIds(channelIds: string[]): Promise<void> {
  if (channelIds.length === 0) return
  await adminDb().from('slack_channel_bindings').delete().in('slack_channel_id', channelIds)
}

/** kill_switch を既定（稼働中）に戻す */
export async function resetKillSwitch(): Promise<void> {
  await adminDb()
    .from('kill_switches')
    .upsert(
      { name: 'ai_responses', enabled: true, reason: null, updated_by: null },
      { onConflict: 'name' },
    )
}
