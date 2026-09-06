#!/usr/bin/env node
/** @file
 * =============================================================================
 *  juku-ai-slack — スタッフ招待リンク発行スクリプト
 * =============================================================================
 *  ⚠️⚠️  このファイルは PUBLIC な GitHub リポジトリに置かれている  ⚠️⚠️
 *
 *  - Service Role キー・URL・メールアドレスを **絶対にこのファイルに書き込まないこと**。
 *    すべて環境変数か引数から読む。
 *  - Service Role キーは RLS を完全にバイパスする。ローカルの .env.local から
 *    読むのは構わないが、シェル履歴に残る形（`SUPABASE_SERVICE_ROLE_KEY=eyJ... node ...`）で
 *    渡さないこと。
 *  - **標準出力に出る招待リンクは、それ単体でそのアカウントを乗っ取れる資格情報**。
 *    Slack DM など本人だけが読める経路で渡し、ターミナルのログを共有しないこと。
 * =============================================================================
 *
 *  なぜこのスクリプトがあるか:
 *    パスワードを Google フォームやチャットで集めると、平文がスプレッドシートや
 *    メッセージ履歴に残り続ける。管理者が決めて連絡する方式も同じ問題が起きる。
 *    そこで「誰もパスワードを知らないアカウントを作り、本人専用の設定リンクだけを渡す」。
 *    Supabase 無料枠のメール送信は 1 時間あたり数通しか送れないため、
 *    メール送信は使わず **リンクを標準出力に出して Slack DM で渡す**。
 *
 *  使い方:
 *    node scripts/invite-staff.mjs --email staff@example.com --role staff \
 *      --app-url https://juku-ai.example.com
 *
 *  詳しい手順書: docs/06_セットアップガイド/step7_管理ユーザーと生徒登録.html
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROLES = ['staff', 'admin']

/** Supabase の招待リンク（recovery）の有効期限。GoTrue の MAILER_OTP_EXP に一致する */
const LINK_TTL_SECONDS = 3600

const HELP = `スタッフ用の管理画面アカウントを作り、本人専用のパスワード設定リンクを発行する。

  使い方:
    node scripts/invite-staff.mjs --email <メールアドレス> --role <staff|admin> [--app-url <URL>]

  引数:
    --email <address>   招待するスタッフのメールアドレス（必須）
    --role  <role>      staff | admin（必須）。staff はチャンネル紐付け・緊急停止ができない
    --app-url <url>     管理画面の URL（例 https://juku-ai.example.com）。
                        リンクはこの URL の /set-password に着地する。
                        省略時は環境変数 APP_URL を使う
    --env-file <path>   環境変数を読み込むファイル（既定 .env.local）
    --reissue-only      既存ユーザー専用。ユーザーが無ければ作らずエラーにする
    --help              このヘルプ

  環境変数（.env.local から自動で読む。既にシェルにある値が優先）:
    NEXT_PUBLIC_SUPABASE_URL    Supabase プロジェクトの URL（必須）
    SUPABASE_SERVICE_ROLE_KEY   Service Role キー（必須。RLS をバイパスするので取り扱い注意）
    APP_URL                     管理画面の URL（--app-url を省略する場合に必須）

  動作:
    1. ユーザーを作成（email_confirm: true / パスワードは UUID 2 個分のランダム 64 文字。誰も知らない）
    2. app_metadata.role に --role の値を設定（user_metadata ではない = 本人が書き換えられない）
    3. Admin API の generate_link（type=recovery）で本人専用リンクを発行
    4. リンクを標準出力に出す（Slack DM で本人に渡す）

    **同じメールのユーザーが既にいる場合は作成せず、ロールを更新してリンクだけ再発行する。**
    リンクは有効期限 ${LINK_TTL_SECONDS / 60} 分・1 回限りなので、期限切れのたびに再実行してよい。

  例:
    # 新しいスタッフを招待する
    node scripts/invite-staff.mjs --email tanaka@example.com --role staff \\
      --app-url https://juku-ai.example.com

    # 期限切れになったリンクを再発行する（ユーザーは作り直さない）
    node scripts/invite-staff.mjs --email tanaka@example.com --role staff \\
      --app-url https://juku-ai.example.com --reissue-only

    # ローカル検証（ローカル Supabase + next dev）
    node scripts/invite-staff.mjs --email test@example.test --role staff \\
      --app-url http://127.0.0.1:3000 --env-file .env.test.example
`

/** `KEY=VALUE` の最小サブセットをパースする（dotenv を足さないため。scripts/test-env.mjs と同じ書式） */
function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** env ファイルを process.env に反映する（既にある値は上書きしない） */
function loadEnvFile(relativePath) {
  const path = join(REPO_ROOT, relativePath)
  if (!existsSync(path)) return false
  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
  return true
}

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      out.help = true
      continue
    }
    if (arg === '--reissue-only') {
      out.reissueOnly = true
      continue
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg)
    if (!match) throw new Error(`不明な引数: ${arg}（--help を参照）`)
    const key = match[1]
    const value = match[2] ?? argv[++i]
    if (value === undefined) throw new Error(`--${key} に値がありません`)
    out[key] = value
  }
  return out
}

function fail(message) {
  console.error(`エラー: ${message}`)
  process.exit(1)
}

/** Admin API を叩く。失敗時は本文込みで投げる（原因が分からないと運用で詰まる） */
async function adminFetch(supabaseUrl, serviceRoleKey, path, init = {}) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  return { ok: res.ok, status: res.status, body }
}

/** メールアドレスからユーザーを引く（Admin API は完全一致検索を持たないのでページングして探す） */
async function findUserByEmail(supabaseUrl, key, email) {
  const target = email.toLowerCase()
  for (let page = 1; page <= 50; page += 1) {
    const { ok, status, body } = await adminFetch(
      supabaseUrl,
      key,
      `/auth/v1/admin/users?page=${page}&per_page=200`,
    )
    if (!ok) throw new Error(`ユーザー一覧の取得に失敗しました (${status}): ${JSON.stringify(body)}`)
    const users = body.users ?? []
    const hit = users.find((u) => u.email?.toLowerCase() === target)
    if (hit) return hit
    if (users.length < 200) return null
  }
  return null
}

/** 誰にも渡さない使い捨てパスワード。設定リンクで本人が上書きするまでのプレースホルダ */
function randomPassword() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    fail(e.message)
    return
  }

  if (args.help || process.argv.length === 2) {
    process.stdout.write(HELP)
    return
  }

  loadEnvFile(typeof args['env-file'] === 'string' ? args['env-file'] : '.env.local')

  const email = typeof args.email === 'string' ? args.email.trim() : ''
  const role = typeof args.role === 'string' ? args.role.trim() : ''
  const appUrl = (typeof args['app-url'] === 'string' ? args['app-url'] : process.env.APP_URL) ?? ''
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail('--email に有効なメールアドレスを指定してください')
  }
  if (!ROLES.includes(role)) fail(`--role は ${ROLES.join(' | ')} のいずれかです（指定値: ${role || '未指定'}）`)
  if (!appUrl) {
    fail(
      '管理画面の URL が分かりません。--app-url https://... を指定するか、環境変数 APP_URL を設定してください。\n' +
        '       この URL は Supabase の Authentication → URL Configuration → Redirect URLs に\n' +
        '       登録されている必要があります（未登録だとリンクが Site URL に着地して使えません）。',
    )
  }
  if (!supabaseUrl) fail('NEXT_PUBLIC_SUPABASE_URL が未設定です（.env.local か環境変数で指定）')
  if (!serviceRoleKey) {
    fail(
      'SUPABASE_SERVICE_ROLE_KEY が未設定です。Supabase → Project Settings → API の\n' +
        '       service_role キーを .env.local に置いてください（このファイルには書かない）。',
    )
  }

  let redirectTo
  try {
    redirectTo = new URL('/set-password', appUrl).toString()
  } catch {
    fail(`--app-url が URL として解釈できません: ${appUrl}`)
    return
  }

  const existing = await findUserByEmail(supabaseUrl, serviceRoleKey, email)

  if (!existing && args.reissueOnly) {
    fail(`${email} のユーザーが存在しません（--reissue-only は既存ユーザー専用です）`)
  }

  let mode
  if (existing) {
    // 作成し直すとレポート等の作成者参照が切れる。ロールだけ合わせてリンクを再発行する。
    // パスワードは触らない（本人が既に設定済みなら維持し、未設定ならリンクで設定される）
    const updated = await adminFetch(
      supabaseUrl,
      serviceRoleKey,
      `/auth/v1/admin/users/${existing.id}`,
      { method: 'PUT', body: JSON.stringify({ email_confirm: true, app_metadata: { role } }) },
    )
    if (!updated.ok) {
      fail(`ロールの更新に失敗しました (${updated.status}): ${JSON.stringify(updated.body)}`)
    }
    mode = 'reissued'
  } else {
    const created = await adminFetch(supabaseUrl, serviceRoleKey, '/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        // 誰も知らないランダム値。本人が招待リンクで上書きする
        password: randomPassword(),
        // 確認メールを送らずに確定させる（無料枠のメール送信数を消費しない）
        email_confirm: true,
        // 権限判定は app_metadata のみ。user_metadata は本人が書き換えられる
        app_metadata: { role },
      }),
    })
    if (!created.ok) {
      fail(`ユーザーの作成に失敗しました (${created.status}): ${JSON.stringify(created.body)}`)
    }
    mode = 'created'
  }

  const link = await adminFetch(supabaseUrl, serviceRoleKey, '/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'recovery', email, redirect_to: redirectTo }),
  })
  if (!link.ok) {
    fail(`招待リンクの発行に失敗しました (${link.status}): ${JSON.stringify(link.body)}`)
  }

  const actionLink = link.body.action_link
  if (!actionLink) fail(`招待リンクが返りませんでした: ${JSON.stringify(link.body)}`)

  const landedOn = new URL(link.body.redirect_to ?? redirectTo).toString()
  const expiresAt = new Date(Date.now() + LINK_TTL_SECONDS * 1000)

  console.log('')
  console.log(`${mode === 'created' ? 'ユーザーを作成しました' : '既存ユーザーのリンクを再発行しました'}: ${email}`)
  console.log(`役割 (app_metadata.role): ${role}`)
  console.log('')
  console.log('--- ここから下を Slack DM で本人に送る -------------------------------')
  console.log('')
  console.log('管理画面のアカウントを用意しました。下のリンクを開いて、ご自身でパスワードを設定してください。')
  console.log(`（リンクは ${LINK_TTL_SECONDS / 60} 分で期限切れになり、1 回しか使えません。切れたら再発行します）`)
  console.log('')
  console.log(actionLink)
  console.log('')
  console.log('----------------------------------------------------------------------')
  console.log('')
  console.log(`有効期限: 発行から ${LINK_TTL_SECONDS / 60} 分（${LINK_TTL_SECONDS} 秒）= ${expiresAt.toLocaleString('ja-JP')} 頃まで`)
  console.log('          出典: Supabase の Authentication → Email → Email OTP Expiration（既定 3600 秒）。')
  console.log('          ローカルは supabase/config.toml の [auth.email] otp_expiry。')
  console.log('          その設定を変えている場合はここの表示とズレる（API から読めないため既定値を表示している）。')
  console.log('使用回数: 1 回のみ（開いた時点で失効。2 回目は「リンクの有効期限が切れています」になる）')
  console.log(`着地先  : ${landedOn}`)
  if (!landedOn.startsWith(new URL(redirectTo).origin)) {
    console.log('')
    console.log('⚠️  着地先が指定した --app-url と違います。Supabase の Redirect URLs に')
    console.log(`   ${redirectTo} を登録してください（未登録だと Site URL に落とされます）。`)
  }
  console.log('')
  console.log('⚠️  このリンクは単体でアカウントを乗っ取れる資格情報です。本人以外に見せないこと。')
  console.log('')
}

await main()
