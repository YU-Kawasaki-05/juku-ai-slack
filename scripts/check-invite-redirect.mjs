#!/usr/bin/env node
/** @file
 * =============================================================================
 *  juku-ai-slack — 招待リンクの着地先が Supabase に登録されているかを確認する
 * =============================================================================
 *  ⚠️⚠️  このファイルは PUBLIC な GitHub リポジトリに置かれている  ⚠️⚠️
 *    キー・URL・メールアドレスをこのファイルに書かないこと。すべて環境変数から読む。
 *    このスクリプトは**環境変数の値を一切標準出力に出さない**（URL の origin と path だけ出す）。
 *
 *  なぜあるか（T-0102）:
 *    Supabase の Authentication → URL Configuration → Redirect URLs に /set-password が
 *    登録されていないと、招待リンクは **エラーにならずに黙って Site URL（トップ）へ着地する**。
 *    スタッフから見ると「リンクを開いたのにパスワードを設定できない」という形で現れ、
 *    原因に到達しにくい。設定できているかどうかを、**先に・壊さずに**確かめたい。
 *
 *  何をするか:
 *    わざと無効なトークンで `/auth/v1/verify` を1回叩き、Supabase が返す 303 の
 *    `Location` ヘッダ（＝着地先）だけを読む。
 *      - 着地先が <app-url>/set-password → Redirect URLs に登録されている
 *      - 着地先が Site URL（別のパス）     → 未登録。リンクを配ると詰まる
 *
 *  何をしないか（安全性）:
 *    - ユーザーを作らない・消さない・変更しない。トークンは無効なので認証は成立しない。
 *    - メールを送らない。
 *    - Service Role キーを使わない（anon キーだけ。無ければヘッダ無しで試す）。
 *    - 受け取った URL のクエリとフラグメントは表示しない（原理上トークンは載らないが、念のため）。
 *
 *  使い方:
 *    node scripts/check-invite-redirect.mjs
 *    node scripts/check-invite-redirect.mjs --app-url https://juku-ai-slack.vercel.app
 *    node scripts/check-invite-redirect.mjs --env-file .env.local
 *
 *  確認できないこと（正直に書いておく）:
 *    Minimum password length が 8 になっているかは、この方法では読めない
 *    （Supabase は認証設定を公開 API で返さない）。実際に招待リンクを1本通すまで未確認のまま。
 * =============================================================================
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `招待リンクの着地先が Supabase の Redirect URLs に登録されているかを確認する。
ユーザーの作成・変更・削除は一切しない（無効なトークンで着地先だけを見る）。

  node scripts/check-invite-redirect.mjs [--app-url <URL>] [--env-file <path>]

  --app-url <url>    管理画面の URL。省略時は環境変数 APP_URL
  --env-file <path>  環境変数を読むファイル（既定 .env.local）
  --help             このヘルプ

  環境変数: NEXT_PUBLIC_SUPABASE_URL（必須） / APP_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY（任意）
`

/** `KEY=VALUE` の最小サブセット。scripts/invite-staff.mjs と同じ書式 */
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

/** URL から origin + pathname だけを取り出す。クエリ・フラグメントは捨てる（値を出さないため） */
function safeDisplay(urlString) {
  try {
    const u = new URL(urlString)
    return `${u.origin}${u.pathname}`
  } catch {
    return '(URL として解釈できない値)'
  }
}

/** 着地先のフラグメント/クエリに載るエラー種別だけを拾う（値は出さない） */
function errorCodeOf(urlString) {
  try {
    const u = new URL(urlString)
    const frag = new URLSearchParams(u.hash.replace(/^#/, ''))
    return frag.get('error_code') ?? u.searchParams.get('error_code') ?? null
  } catch {
    return null
  }
}

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}

const args = {}
for (let i = 0; i < argv.length; i += 1) {
  const m = /^--([a-z-]+)$/.exec(argv[i])
  if (!m) {
    console.error(`不明な引数: ${argv[i]}（--help を参照）`)
    process.exit(1)
  }
  args[m[1]] = argv[++i]
}

loadEnvFile(args['env-file'] ?? '.env.local')

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const appUrl = args['app-url'] ?? process.env.APP_URL ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

if (!supabaseUrl) {
  console.error('NEXT_PUBLIC_SUPABASE_URL が未設定です（.env.local か環境変数で指定）')
  process.exit(1)
}
if (!appUrl) {
  console.error('管理画面の URL が分かりません。--app-url https://... か環境変数 APP_URL を指定してください')
  process.exit(1)
}

let redirectTo
try {
  redirectTo = new URL('/set-password', appUrl).toString()
} catch {
  console.error(`--app-url が URL として解釈できません: ${appUrl}`)
  process.exit(1)
}

// 存在しないトークン。形式だけ recovery のものに似せる（実在しないので認証は成立しない）
const probeToken = `invalid-probe-${'0'.repeat(32)}`
const probeUrl =
  `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(probeToken)}` +
  `&type=recovery&redirect_to=${encodeURIComponent(redirectTo)}`

console.log('招待リンクの着地先を確認します（ユーザーの作成・変更・削除はしません）')
console.log(`  Supabase : ${safeDisplay(supabaseUrl)}`)
console.log(`  期待する着地先: ${safeDisplay(redirectTo)}`)
console.log('')

const res = await fetch(probeUrl, {
  method: 'GET',
  redirect: 'manual',
  headers: anonKey ? { apikey: anonKey } : {},
})

const location = res.headers.get('location')
console.log(`  HTTP ${res.status}`)

if (!location) {
  console.log('')
  console.log('判定: 不明。Location ヘッダが返りませんでした。')
  console.log('  この方法では確認できません。実際に招待リンクを1本発行して開いてください。')
  process.exit(2)
}

const landed = safeDisplay(location)
const expected = safeDisplay(redirectTo)
const code = errorCodeOf(location)

console.log(`  着地先 : ${landed}`)
if (code) console.log(`  エラー種別: ${code}（無効なトークンを送っているので出て正常）`)
console.log('')

if (landed === expected) {
  console.log('判定: ✅ 登録されています。')
  console.log('  Redirect URLs に /set-password があり、招待リンクは正しい画面に着地します。')
  console.log('')
  console.log('  ただし、これで確認できたのは「着地先」だけです。')
  console.log('  パスワードを実際に設定できるか（Minimum password length = 8 を含む）は、')
  console.log('  招待リンクを1本通すまで未確認のままです。')
  process.exit(0)
}

console.log('判定: ❌ 未登録の可能性が高い。')
console.log(`  期待: ${expected}`)
console.log(`  実際: ${landed}`)
console.log('')
console.log('  Supabase → Authentication → URL Configuration → Redirect URLs に')
console.log(`  ${expected} を追加してください。`)
console.log('  未登録だとリンクは黙って Site URL に着地し、スタッフはパスワードを設定できません。')
process.exit(1)
