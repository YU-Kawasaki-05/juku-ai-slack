/** @file
 * 機能: 受け入れテスト（AT-XX）専用のヘルパー。Slack 署名生成・モック参照・証拠スクショ・DB 種まき
 * 備考: 既存 e2e/*.spec.ts からは参照しない（受け入れテストを独立させるため）。
 *   DB 操作は e2e/fixtures/db.ts の Service Role クライアントを再利用する。
 */
import { createHmac } from 'node:crypto'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { adminDb } from '../fixtures/db'

/** 証拠スクリーンショットの保存先（レポートから相対リンクする） */
export const EVIDENCE_DIR = 'docs/07_受け入れテスト/evidence'

/** モックサーバー（Slack Web API + OpenAI 互換 LLM）のベース URL */
export const MOCK_BASE = `http://127.0.0.1:${process.env.MOCK_PORT ?? '3251'}`

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? ''
const BOT_USER_ID = process.env.SLACK_BOT_USER_ID ?? 'U0E2EBOTUSER'

/** 判定ポイントが写った証拠を残す。ファイル名は `AT-XX_説明.png` に揃える */
export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}.png`, fullPage: true })
}

// --- Slack Events Webhook ----------------------------------------------------

export function slackSign(rawBody: string, timestamp: string): string {
  return `v0=${createHmac('sha256', SIGNING_SECRET).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`
}

export interface SlackMessageEventInput {
  eventId: string
  channel: string
  ts: string
  text?: string
  user?: string
  threadTs?: string
  botId?: string
  subtype?: string
  teamId?: string
}

/** Bot メンション付きの本文にする（BR-02-03: 直下はメンション必須） */
export function withMention(text: string): string {
  return `<@${BOT_USER_ID}> ${text}`
}

export function buildEventCallback(input: SlackMessageEventInput): string {
  const event: Record<string, unknown> = {
    type: 'message',
    channel: input.channel,
    ts: input.ts,
    user: input.user ?? 'U0STUDENT1',
  }
  if (input.text !== undefined) event.text = input.text
  if (input.threadTs) event.thread_ts = input.threadTs
  if (input.botId) event.bot_id = input.botId
  if (input.subtype) event.subtype = input.subtype

  return JSON.stringify({
    type: 'event_callback',
    event_id: input.eventId,
    team_id: input.teamId ?? 'T0E2ETEAM',
    event,
  })
}

/** 正しい署名を付けて Slack イベントを投げる（実 Slack は関与しない） */
export async function postSlackEvent(
  request: APIRequestContext,
  rawBody: string,
  overrides: { timestamp?: string; signature?: string } = {},
) {
  const ts = overrides.timestamp ?? String(Math.floor(Date.now() / 1000))
  return request.post('/api/slack/events', {
    data: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': overrides.signature ?? slackSign(rawBody, ts),
    },
  })
}

// --- モックサーバーの参照 -----------------------------------------------------

export interface MockCall {
  id: number
  at: string
  kind: 'slack' | 'llm'
  method: string
  body: Record<string, unknown>
  raw: string
}

export interface MockQuery {
  kind?: 'slack' | 'llm'
  method?: string
  channel?: string
  contains?: string
}

export async function mockCalls(request: APIRequestContext, query: MockQuery): Promise<MockCall[]> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v)
  const res = await request.get(`${MOCK_BASE}/__mock/calls?${params.toString()}`)
  expect(res.ok(), 'モックサーバーが応答しません').toBeTruthy()
  const json = (await res.json()) as { calls: MockCall[] }
  return json.calls
}

/**
 * 条件を満たす呼び出しが `min` 件になるまで待つ。
 * `after()` のバックグラウンド処理は ACK 後に走るため、HTTP 応答を待つだけでは足りない。
 */
export async function waitForMockCalls(
  request: APIRequestContext,
  query: MockQuery,
  opts: { min?: number; timeoutMs?: number } = {},
): Promise<MockCall[]> {
  const min = opts.min ?? 1
  const timeoutMs = opts.timeoutMs ?? 25_000
  const deadline = Date.now() + timeoutMs
  let last: MockCall[] = []
  while (Date.now() < deadline) {
    last = await mockCalls(request, query)
    if (last.length >= min) return last
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(
    `モック呼び出しが ${min} 件に達しませんでした（${JSON.stringify(query)}, 実際 ${last.length} 件）`,
  )
}

/**
 * 「起きないこと」の確認用。指定時間待って、条件に合う呼び出しが 0 件のままであることを返す。
 * 無反応（AC-02-02 / H-6）の検証に使う。
 */
export async function expectNoMockCalls(
  request: APIRequestContext,
  query: MockQuery,
  waitMs = 4_000,
): Promise<void> {
  await new Promise((r) => setTimeout(r, waitMs))
  const calls = await mockCalls(request, query)
  expect(calls, `想定外の外部呼び出しが発生しました: ${JSON.stringify(calls.map((c) => c.method))}`).toHaveLength(0)
}

/** chat.postMessage の本文を取り出す */
export function postedTexts(calls: MockCall[]): string[] {
  return calls.filter((c) => c.method === 'chat.postMessage').map((c) => String(c.body.text ?? ''))
}

// --- DB 種まき ---------------------------------------------------------------

export interface SeedBindingArgs {
  channelId: string
  personId: string
  teamId?: string
  status?: 'active' | 'inactive'
  channelName?: string
}

export async function createBinding(args: SeedBindingArgs): Promise<{ id: string }> {
  const { data, error } = await adminDb()
    .from('slack_channel_bindings')
    .insert({
      slack_team_id: args.teamId ?? 'T0E2ETEAM',
      slack_channel_id: args.channelId,
      slack_channel_name: args.channelName ?? 'at-test-channel',
      person_id: args.personId,
      status: args.status ?? 'active',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`AT: 紐付けの作成に失敗 ${error?.message}`)
  return data as { id: string }
}

export async function setPersonStatus(personId: string, status: 'active' | 'inactive'): Promise<void> {
  const { error } = await adminDb().from('persons').update({ status }).eq('id', personId)
  if (error) throw new Error(`AT: 生徒 status の更新に失敗 ${error.message}`)
}

/** kill_switch を直接書き換える（UI を経由しない前提条件づくり） */
export async function setKillSwitch(enabled: boolean, reason: string | null = null): Promise<void> {
  const { error } = await adminDb()
    .from('kill_switches')
    .upsert(
      { name: 'ai_responses', enabled, reason, updated_at: new Date().toISOString(), updated_by: 'acceptance-test' },
      { onConflict: 'name' },
    )
  if (error) throw new Error(`AT: kill_switch の更新に失敗 ${error.message}`)
}

/** レート制限（10回/時）の前提づくり。質問としてカウントされる形の usage ログを積む */
export async function seedUsageLogs(args: {
  personId: string
  channelId: string
  count: number
}): Promise<void> {
  const rows = Array.from({ length: args.count }, (_, i) => ({
    person_id: args.personId,
    slack_channel_id: args.channelId,
    thread_ts: `seed.${i}`,
    // `-eval` / `-summary` サフィックスは質問数から除外されるので付けない
    message_ts: `seed.${i}`,
    model: 'mock/tutor-model',
    input_tokens: 10,
    output_tokens: 10,
    total_tokens: 20,
    estimated_cost: 0,
    created_at: new Date(Date.now() - i * 60_000).toISOString(),
  }))
  const { error } = await adminDb().from('ai_usage_logs').insert(rows)
  if (error) throw new Error(`AT: usage ログの種まきに失敗 ${error.message}`)
}

/** ジョブ・メッセージ・ログを含めてチャンネル単位で後片付けする */
export async function cleanupChannels(channelIds: string[]): Promise<void> {
  if (channelIds.length === 0) return
  const db = adminDb()
  // jobs を残すと /admin/jobs の「積み残し」に受け入れテストのゴミが永続的に積み上がる
  await db.from('jobs').delete().in('payload->>channelId', channelIds)
  await db.from('ai_usage_logs').delete().in('slack_channel_id', channelIds)
  await db.from('ai_error_logs').delete().in('slack_channel_id', channelIds)
  await db.from('slack_messages').delete().in('slack_channel_id', channelIds)
  await db.from('slack_thread_sessions').delete().in('slack_channel_id', channelIds)
  await db.from('slack_channel_bindings').delete().in('slack_channel_id', channelIds)
}

/** person 単位で残る従属行（チャンネルに紐づかないもの）を消す */
export async function cleanupPersonData(personIds: string[]): Promise<void> {
  if (personIds.length === 0) return
  const db = adminDb()
  await db.from('ai_usage_logs').delete().in('person_id', personIds)
  await db.from('ai_error_logs').delete().in('person_id', personIds)
  await db.from('slack_messages').delete().in('person_id', personIds)
  await db.from('student_profiles').delete().in('person_id', personIds)
  await db.from('student_knowledge_states').delete().in('person_id', personIds)
}

/** ジョブ行を event_id で引く（jobs の payload に eventId が入る） */
export async function findJobByEventId(eventId: string): Promise<Record<string, unknown> | null> {
  const { data } = await adminDb()
    .from('jobs')
    .select('*')
    .eq('payload->>eventId', eventId)
    .maybeSingle()
  return (data as Record<string, unknown> | null) ?? null
}

// --- Supabase Auth / PostgREST を直接叩く（RLS の実効確認用） -----------------

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54341'
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/**
 * ロールを持たないテストユーザーを冪等に作る。
 * 「サインアップできただけのユーザー」= 権限昇格の出発点を再現するため app_metadata は空にする。
 */
export async function upsertRolelessUser(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
  const body = { email, password, email_confirm: true, app_metadata: {} }

  const created = await request.post(`${SUPABASE_URL}/auth/v1/admin/users`, { headers, data: body })
  if (created.ok()) return ((await created.json()) as { id: string }).id

  const list = await request.get(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, { headers })
  const { users } = (await list.json()) as { users: Array<{ id: string; email: string }> }
  const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!existing) throw new Error(`AT: ロールなしユーザーの作成に失敗 ${await created.text()}`)
  const updated = await request.put(`${SUPABASE_URL}/auth/v1/admin/users/${existing.id}`, { headers, data: body })
  if (!updated.ok()) throw new Error(`AT: ロールなしユーザーの更新に失敗 ${await updated.text()}`)
  return existing.id
}

export async function deleteAuthUser(request: APIRequestContext, userId: string): Promise<void> {
  await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  })
}

/** パスワードグラントで access_token を得る（ブラウザの anon クライアントと同じ経路） */
export async function signInForToken(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    data: { email, password },
  })
  expect(res.ok(), `AT: ${email} のログインに失敗 ${await res.text()}`).toBeTruthy()
  return ((await res.json()) as { access_token: string }).access_token
}

/** anon key（+ 任意の JWT）で PostgREST の SELECT を試みる。RLS が効いていれば 0 行 */
export async function restSelect(
  request: APIRequestContext,
  table: string,
  accessToken?: string,
): Promise<{ status: number; rows: unknown[]; body: string }> {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=5`, {
    headers: {
      apikey: ANON_KEY,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  })
  const text = await res.text()
  let rows: unknown[] = []
  try {
    const parsed = JSON.parse(text)
    rows = Array.isArray(parsed) ? parsed : []
  } catch {
    rows = []
  }
  return { status: res.status(), rows, body: text }
}

/** anon key（+ 任意の JWT）で PostgREST の INSERT を試みる */
export async function restInsert(
  request: APIRequestContext,
  table: string,
  payload: Record<string, unknown>,
  accessToken?: string,
): Promise<number> {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: {
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    data: payload,
  })
  return res.status()
}

/** user_metadata を自分で書き換える（権限昇格を試みる負のテスト） */
export async function selfSetUserMetadata(
  request: APIRequestContext,
  accessToken: string,
  data: Record<string, unknown>,
): Promise<number> {
  const res = await request.put(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    data: { data },
  })
  return res.status()
}

/**
 * 判定ポイントの証拠を残す。Slack への返信は画面に出ないので、
 * 対応する ai_error_logs の詳細画面（エラーコード + 生徒 + チャンネル + 内部詳細）を撮る。
 */
export async function shotErrorDetail(
  page: Page,
  args: { channelId: string; code: string; name: string },
): Promise<void> {
  const logs = await findErrorLogs(args.channelId, { code: args.code })
  const target = logs.find((l) => l.error_code === args.code)
  expect(target, `AT: ${args.code} のエラーログが見つかりません（証拠を撮れません）`).toBeTruthy()

  await page.goto(`/admin/errors/${String(target!.id)}`)
  await expect(page.getByRole('heading', { name: args.code, level: 1 })).toBeVisible()
  await shot(page, args.name)
}

/**
 * エラーログを取得する。`code` を指定すると、その行が現れるまでポーリングする。
 *
 * ジョブ処理は「Slack へ投稿 → jobs 更新 → logError」の順なので、
 * モック Slack への投稿を観測した時点ではログがまだ書かれていないことがある。
 * 単発 SELECT だと稀に取りこぼす（AT-40 が実際にフレークした）。
 */
export async function findErrorLogs(
  channelId: string,
  opts: { code?: string; timeoutMs?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000)
  let logs: Array<Record<string, unknown>> = []

  for (;;) {
    const { data } = await adminDb()
      .from('ai_error_logs')
      .select('*')
      .eq('slack_channel_id', channelId)
      .order('created_at', { ascending: false })
    logs = (data as Array<Record<string, unknown>>) ?? []

    const satisfied = opts.code ? logs.some((l) => l.error_code === opts.code) : logs.length > 0
    if (satisfied || Date.now() >= deadline) return logs

    await new Promise((r) => setTimeout(r, 200))
  }
}
