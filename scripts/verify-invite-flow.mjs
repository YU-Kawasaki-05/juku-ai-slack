#!/usr/bin/env node
/** @file
 * =============================================================================
 *  juku-ai-slack — 招待リンクが本当に通るかを、端から端まで1回試す
 * =============================================================================
 *  ⚠️⚠️  このファイルは PUBLIC な GitHub リポジトリに置かれている  ⚠️⚠️
 *    キー・URL・メールアドレスをこのファイルに書かないこと。すべて環境変数か引数から読む。
 *
 *  なぜあるか（T-0102）:
 *    「招待リンクでどの程度パスワードの設定ができるのか分からない」への答えは、
 *    **実際に1回通すこと**。ただし本番のスタッフに配ってから試すわけにはいかない。
 *    このスクリプトは使い捨てのユーザーを1つ作り、招待リンクの発行 → セッション確立 →
 *    パスワード設定 → そのパスワードでのログイン、までを通しで確認する。
 *
 *  ★ 資格情報を画面に出さない
 *    招待リンクは**それ単体でアカウントを乗っ取れる資格情報**。scripts/invite-staff.mjs は
 *    人が Slack DM で渡すために標準出力へ出すが、こちらは人に渡さないので**一切表示しない**。
 *    リンク・アクセストークン・設定したパスワードはすべてプロセス内だけで扱う。
 *    ターミナルのログを共有しても漏れない。
 *
 *  何を確かめるか:
 *    1. 招待リンクが発行できる
 *    2. リンクの着地先が <app-url>/set-password になる（Redirect URLs が登録されている）
 *    3. リンクからセッションが確立できる（access_token が返る）
 *    4. **短すぎるパスワードがサーバー側で拒否される**（Minimum password length の実測）
 *    5. 規定の長さのパスワードなら設定できる
 *    6. そのパスワードでログインでき、役割（app_metadata.role）が意図どおり付いている
 *    7. リンクが1回限りであること（2回目は失敗する）
 *
 *  安全のために:
 *    - **既に存在するメールアドレスでは実行しない**（実在のスタッフ・管理者を触らないため）。
 *    - 作ったユーザーは消せない（削除は人の操作）。最後に消す手順を表示する。
 *
 *  使い方:
 *    node scripts/verify-invite-flow.mjs --email <使い捨てのアドレス> \
 *      --app-url https://juku-ai-slack.vercel.app
 * =============================================================================
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `招待リンクの発行→パスワード設定→ログインを1回通しで確認する。
リンク・トークン・パスワードは一切表示しない。

  node scripts/verify-invite-flow.mjs --email <アドレス> --app-url <URL> [--role staff|admin]

  --email <address>  使い捨てのアドレス。**既存ユーザーのアドレスでは実行しない**
  --app-url <url>    管理画面の URL（省略時は環境変数 APP_URL）
  --role <role>      付与する役割（既定 staff）
  --env-file <path>  環境変数を読むファイル（既定 .env.local）
  --help             このヘルプ

  確認後、作ったユーザーは Supabase 管理画面から削除してください（削除は人の操作）。
`

function parseEnvFile(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[trimmed.slice(0, eq).trim()] = value
  }
  return out
}

function loadEnvFile(relativePath) {
  const path = join(REPO_ROOT, relativePath)
  if (!existsSync(path)) return false
  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
  return true
}

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
  process.stdout.write(HELP)
  process.exit(0)
}
const argOf = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}

loadEnvFile(argOf('--env-file') ?? '.env.local')

const email = (argOf('--email') ?? '').trim()
const role = (argOf('--role') ?? 'staff').trim()
const appUrl = argOf('--app-url') ?? process.env.APP_URL ?? ''
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const die = (m) => {
  console.error(`エラー: ${m}`)
  process.exit(2)
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('--email に有効なアドレスを指定してください')
if (!['staff', 'admin'].includes(role)) die('--role は staff か admin')
if (!appUrl) die('--app-url か環境変数 APP_URL が要ります')
if (!supabaseUrl || !serviceRoleKey) die('NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が要ります')
if (!anonKey) die('NEXT_PUBLIC_SUPABASE_ANON_KEY が要ります（ログイン確認に使います）')

const admin = (path, init = {}) =>
  fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

const steps = []
const step = (name, ok, detail) => {
  steps.push({ name, ok, detail })
  const mark = ok === true ? '  OK  ' : ok === null ? '  --  ' : '  NG  '
  console.log(`${mark} ${name}${detail ? `  … ${detail}` : ''}`)
}

console.log('招待リンクの開通確認')
console.log(`  対象: ${email}（役割 ${role}）`)
console.log('  リンク・トークン・パスワードは表示しません。')
console.log('')

// --- 0. 既存ユーザーでないことを確かめる（実在のスタッフを触らない） ---
{
  const target = email.toLowerCase()
  let found = null
  for (let page = 1; page <= 50; page += 1) {
    const res = await admin(`/auth/v1/admin/users?page=${page}&per_page=200`)
    if (!res.ok) die(`ユーザー一覧の取得に失敗しました (${res.status})`)
    const body = await res.json()
    const users = body.users ?? []
    found = users.find((u) => (u.email ?? '').toLowerCase() === target) ?? null
    if (found || users.length < 200) break
  }
  if (found) {
    console.error('')
    console.error(`エラー: ${email} は既にユーザーとして存在します。`)
    console.error('       このスクリプトは使い捨てのアドレス専用です。実在の管理者・スタッフの')
    console.error('       パスワードや役割を書き換えてしまうため、ここで中止します。')
    process.exit(2)
  }
  step('対象が新規のアドレスであること', true, '既存ユーザーと衝突しない')
}

// --- 1. ユーザー作成 + 招待リンク発行 ---
const throwawayPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
const created = await admin('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email, password: throwawayPassword, email_confirm: true, app_metadata: { role } }),
})
if (!created.ok) die(`ユーザーの作成に失敗しました (${created.status})`)
const createdUser = await created.json()
step('使い捨てユーザーの作成', true, `id の先頭8桁 ${String(createdUser.id).slice(0, 8)}…`)

const redirectTo = new URL('/set-password', appUrl).toString()
const linkRes = await admin('/auth/v1/admin/generate_link', {
  method: 'POST',
  body: JSON.stringify({ type: 'recovery', email, redirect_to: redirectTo }),
})
if (!linkRes.ok) die(`招待リンクの発行に失敗しました (${linkRes.status})`)
const linkBody = await linkRes.json()
const actionLink = linkBody.action_link // ★ 表示しない
if (!actionLink) die('招待リンクが返りませんでした')
step('招待リンクの発行', true, '発行できた（内容は表示しない）')

// --- 2〜3. リンクを開いて着地先とセッションを確かめる ---
const opened = await fetch(actionLink, { method: 'GET', redirect: 'manual' })
const location = opened.headers.get('location')
if (!location) die(`リンクを開いても Location が返りませんでした (HTTP ${opened.status})`)

const landed = new URL(location)
const expected = new URL(redirectTo)
step(
  '着地先が /set-password',
  `${landed.origin}${landed.pathname}` === `${expected.origin}${expected.pathname}`,
  `${landed.origin}${landed.pathname}`,
)

const frag = new URLSearchParams(landed.hash.replace(/^#/, ''))
const accessToken = frag.get('access_token') // ★ 表示しない
const refreshToken = frag.get('refresh_token')
if (!accessToken) {
  step('セッションの確立', false, `フラグメントに access_token が無い（error_code=${frag.get('error_code') ?? '不明'}）`)
  console.error('\nここで止まります。以降の確認はできません。')
  process.exit(1)
}
step('セッションの確立', true, `access_token と refresh_token が返った（refresh ${refreshToken ? 'あり' : 'なし'}）`)

// --- 4. 短いパスワードがサーバー側で拒否されるか（Minimum password length の実測） ---
const asUser = (body) =>
  fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

{
  // 7文字。画面側は 8 文字以上を要求している（passwordSetup.ts の MIN_PASSWORD_LENGTH）。
  // サーバー側の最小長が 8 なら、ここは必ず拒否される。
  const res = await asUser({ password: 'Ab3!xY9' })
  if (res.status === 200) {
    step('短いパスワードの拒否（7文字）', false, 'サーバーが受け入れてしまった＝最小長が 8 未満')
  } else {
    const body = await res.json().catch(() => ({}))
    step('短いパスワードの拒否（7文字）', true, `HTTP ${res.status} ${body.error_code ?? body.msg ?? ''}`.trim())
  }
}

// --- 5. 規定の長さなら設定できる ---
const realPassword = `${crypto.randomUUID()}Aa1!` // ★ 表示しない
{
  const res = await asUser({ password: realPassword })
  if (!res.ok) {
    const body = await res.text()
    step('パスワードの設定', false, `HTTP ${res.status} ${body.slice(0, 120)}`)
    console.error('\nここで止まります。')
    process.exit(1)
  }
  step('パスワードの設定', true, `HTTP ${res.status}`)
}

// --- 6. そのパスワードでログインできるか ---
{
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: realPassword }),
  })
  const body = await res.json().catch(() => ({}))
  if (res.ok && body.access_token) {
    const gotRole = body.user?.app_metadata?.role
    step('設定したパスワードでログイン', true, `role=${gotRole}`)
    step('役割が意図どおり', gotRole === role, `期待 ${role} / 実際 ${gotRole}`)
  } else {
    step('設定したパスワードでログイン', false, `HTTP ${res.status} ${body.error_code ?? ''}`)
  }
}

// --- 7. リンクが1回限りであること ---
{
  const again = await fetch(actionLink, { method: 'GET', redirect: 'manual' })
  const loc = again.headers.get('location') ?? ''
  const reused = new URLSearchParams(new URL(loc, appUrl).hash.replace(/^#/, '')).get('access_token')
  step('リンクは1回限り', !reused, reused ? '2回目も通ってしまった' : '2回目はセッションが返らない')
}

// --- まとめ ---
const ng = steps.filter((s) => s.ok === false)
console.log('')
console.log(`  ${steps.length} 項目中 ${ng.length} 件が不合格`)
console.log('')
console.log('⚠️ 使い捨てユーザーが残っています。削除してください（削除は人の操作）:')
console.log('   Supabase → Authentication → Users → 該当行 → Delete user')
console.log(`   対象: ${email}`)
console.log('')
process.exit(ng.length > 0 ? 1 : 0)
