#!/usr/bin/env node
/** @file
 * =============================================================================
 *  juku-ai-slack — 導入した1塾ぶんの環境が「本当に使える状態か」を1コマンドで確かめる
 * =============================================================================
 *  ⚠️⚠️  このファイルは PUBLIC な GitHub リポジトリに置かれている  ⚠️⚠️
 *    キー・URL・メールアドレスをこのファイルに書かないこと。すべて環境変数から読む。
 *    **このスクリプトは秘密の値を一切表示しない**（設定されているか／何文字か、までしか出さない）。
 *
 *  なぜあるか（導入の自動化・段階1）:
 *    docs/06_セットアップガイド は STEP1〜9 で約 2 時間55分の手作業。終わったあとに
 *    「本当に全部できているか」を確かめる手段が、実際に Slack で質問を投げてみることしか無い。
 *    そして**失敗は静かに起きる**（Redirect URLs 未登録・LLM キー未設定・マイグレーション漏れは、
 *    どれもビルドを通り、デプロイも成功し、生徒が最初の質問を投げた瞬間に初めて露見する）。
 *    ここを1コマンドにすると、2社目以降の導入が「手順を祈りながらなぞる」から
 *    「赤が出なくなるまで潰す」に変わる。
 *
 *  ★ 設計上の要点（env.ts との違い）
 *    `src/shared/lib/env.ts` の zod スキーマで**必須**なのは 6 項目だけ。LLM_API_KEY などが
 *    optional なのは「未設定でもビルドと他機能を壊さない」ため（意図的な設計）。
 *    つまり **env のパースを通っても、回答が1件も返らない環境が作れてしまう**。
 *    このスクリプトは「ビルドが通るか」ではなく「**塾で使えるか**」を基準にする。
 *
 *  何をしないか（安全性）:
 *    - 書き込みを一切しない。すべて読み取りと疎通確認だけ。
 *    - 生徒の氏名・質問・成績を読まない・表示しない（件数しか見ない）。
 *    - LLM の課金リクエストを既定では投げない（--deep のときだけ1回投げる）。
 *
 *  使い方:
 *    node scripts/check-deployment.mjs
 *    node scripts/check-deployment.mjs --app-url https://juku-ai-slack.vercel.app
 *    node scripts/check-deployment.mjs --deep          # LLM に実リクエストを1回投げる（課金あり・極小）
 *    node scripts/check-deployment.mjs --env-file .env.production.local
 *
 *  終了コード: 0=必須項目すべて合格 / 1=必須に不合格あり / 2=実行できなかった
 * =============================================================================
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `導入した環境が「塾で使える状態か」を1コマンドで確かめる。書き込みは一切しない。

  node scripts/check-deployment.mjs [--app-url <URL>] [--env-file <path>] [--deep]

  --app-url <url>    管理画面の URL（省略時は環境変数 APP_URL）
  --env-file <path>  環境変数を読むファイル（既定 .env.local）
  --deep             LLM に実リクエストを1回投げて応答を確かめる（課金あり・極小）
  --help             このヘルプ

  秘密の値は表示しません（設定の有無と文字数まで）。
`

// ---- 環境変数の読み込み（scripts/invite-staff.mjs と同じ最小サブセット） ----

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

// ---- 結果の収集 ----

const TTY = process.stdout.isTTY && !process.env.NO_COLOR
const c = (code) => (s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const red = c(31)
const green = c(32)
const yellow = c(33)
const dim = c(2)
const bold = c(1)

/** @type {{section:string,name:string,level:'required'|'recommended',ok:boolean|null,detail:string,fix?:string}[]} */
const results = []
let section = ''
const setSection = (s) => {
  section = s
}
const pass = (name, detail = '') => results.push({ section, name, level: 'required', ok: true, detail })
const fail = (name, detail, fix) =>
  results.push({ section, name, level: 'required', ok: false, detail, fix })
const warn = (name, detail, fix) =>
  results.push({ section, name, level: 'recommended', ok: false, detail, fix })
const info = (name, detail) =>
  results.push({ section, name, level: 'recommended', ok: true, detail })
const skip = (name, detail) => results.push({ section, name, level: 'recommended', ok: null, detail })

// ---- 引数 ----

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}
const deep = argv.includes('--deep')
const argOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

loadEnvFile(argOf('--env-file') ?? '.env.local')

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const appUrl = argOf('--app-url') ?? process.env.APP_URL ?? ''

// =============================================================================
// 1. 環境変数
// =============================================================================
setSection('1. 環境変数')

/**
 * 「ビルドに要る」ではなく「塾で使えるのに要る」で分類する。
 * env.ts が optional にしているものでも、無ければ回答が返らないものは required に入れる。
 */
const ENV_REQUIRED = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'Supabase のプロジェクト URL'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Supabase の anon キー'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase の service_role キー'],
  ['SLACK_BOT_TOKEN', 'Slack の Bot Token（xoxb-）'],
  ['SLACK_SIGNING_SECRET', 'Slack の Signing Secret'],
  ['SLACK_BOT_USER_ID', 'Slack の Bot ユーザー ID（U...）'],
  // ↓ env.ts では optional だが、無いと「質問しても何も返らない」状態になる
  ['LLM_API_KEY', 'LLM の API キー（無いと回答が1件も返らない）'],
  ['LLM_BASE_URL', 'LLM のエンドポイント（無いと回答が1件も返らない）'],
  ['LLM_MODEL_DEFAULT', '通常の回答に使うモデル名（無いと回答が1件も返らない）'],
]

const ENV_RECOMMENDED = [
  ['LLM_MODEL_COMPLEX', '画像つき質問に使う Vision モデル。未設定だと画像を読まずに回答する'],
  ['EMBEDDING_API_KEY', 'レポート検索（RAG）。未設定だとレポートを参照せずに回答する'],
  ['EMBEDDING_BASE_URL', '同上'],
  ['EMBEDDING_MODEL', '同上'],
  ['SLACK_ALERTS_CHANNEL_ID', '緊急停止の通知先。未設定だと停止/再開が誰にも通知されない'],
  ['SLACK_WORKSPACE_URL', '管理画面のエラーから Slack スレッドを開くリンク。未設定ならリンク非表示'],
]

for (const [key, why] of ENV_REQUIRED) {
  const v = process.env[key]
  if (v && v.trim()) pass(key, `設定あり（${v.trim().length} 文字）`)
  else fail(key, '未設定', `${why}。Vercel の Environment Variables と .env.local の両方に設定する`)
}
for (const [key, why] of ENV_RECOMMENDED) {
  const v = process.env[key]
  if (v && v.trim()) info(key, `設定あり（${v.trim().length} 文字）`)
  else warn(key, '未設定', why)
}

// 形式のばらつきを拾う（値そのものは出さない）
if (process.env.SLACK_BOT_TOKEN && !process.env.SLACK_BOT_TOKEN.startsWith('xoxb-')) {
  warn('SLACK_BOT_TOKEN の形式', 'xoxb- で始まっていない', 'Bot Token ではなく User Token を入れている可能性がある')
}
if (process.env.SLACK_BOT_USER_ID && !/^U[A-Z0-9]+$/.test(process.env.SLACK_BOT_USER_ID)) {
  warn('SLACK_BOT_USER_ID の形式', 'U で始まる ID になっていない', 'Slack の Bot ユーザー ID を確認する')
}

// =============================================================================
// 2. Supabase（到達性・マイグレーション・データ）
// =============================================================================
setSection('2. Supabase')

const TABLES = [
  'persons',
  'student_profiles',
  'reports',
  'report_chunks',
  'slack_channel_bindings',
  'slack_thread_sessions',
  'slack_messages',
  'attachments',
  'ai_usage_logs',
  'ai_error_logs',
  'slack_event_receipts',
  'jobs',
  'student_knowledge_states',
  'student_episodic_memories',
  'learning_concepts',
  'kill_switches',
]

const sb = (path, init = {}) =>
  fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(init.headers ?? {}),
    },
  })

if (!supabaseUrl || !serviceRoleKey) {
  skip('接続', 'URL か service_role キーが無いので確認できません')
} else {
  let reachable = false
  try {
    const res = await sb('/rest/v1/', {})
    reachable = res.ok || res.status === 404
    if (reachable) pass('接続', `REST API に到達（HTTP ${res.status}）`)
    else fail('接続', `HTTP ${res.status}`, 'URL と service_role キーが正しいか確認する')
  } catch (e) {
    fail('接続', `到達できない（${e.code ?? e.name}）`, 'NEXT_PUBLIC_SUPABASE_URL を確認する。プロジェクトが一時停止していないかも見る')
  }

  if (reachable) {
    const missing = []
    for (const t of TABLES) {
      const res = await sb(`/rest/v1/${t}?select=*&limit=0`, {
        headers: { Prefer: 'count=exact', Range: '0-0' },
      })
      if (!res.ok) missing.push(t)
    }
    if (missing.length === 0) {
      pass('マイグレーション', `${TABLES.length} テーブルすべて存在`)
    } else {
      fail(
        'マイグレーション',
        `${missing.length} テーブルが無い: ${missing.join(', ')}`,
        'supabase/migrations/ の SQL を 001 から順に全部流す（STEP 3）',
      )
    }

    // pgvector（レポート検索の土台）。**実際に検索を1回走らせて**確かめる。
    // 引数なしで叩くと PostgREST は「関数が無い」と区別できない 404 を返すので、
    // 存在確認にならない（最初この誤検知で「関数が無い」と誤報した）。
    // 存在しない person の zero ベクトルで引くので、必ず0件が返る読み取り専用の呼び出し。
    const rpc = await sb('/rest/v1/rpc/match_report_chunks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_person_id: '00000000-0000-0000-0000-000000000000',
        p_query_embedding: new Array(1536).fill(0),
        p_top_k: 1,
        p_threshold: 0.7,
      }),
    })
    if (rpc.ok) {
      pass('pgvector / 検索関数', 'match_report_chunks が実際に実行できた')
    } else {
      const body = await rpc.text()
      fail(
        'pgvector / 検索関数',
        `実行できない（HTTP ${rpc.status}）`,
        '004_enable_pgvector.sql・020_create_match_report_chunks.sql・021_harden_match_report_chunks.sql を流す。' +
          `応答: ${body.slice(0, 160)}`,
      )
    }

    // 緊急停止の状態（止まったまま納品すると「動かない」と言われる）
    // 主キーは name（'ai_responses'）。key ではない（031_create_kill_switches.sql）
    const ks = await sb('/rest/v1/kill_switches?select=name,enabled')
    if (ks.ok) {
      const rows = await ks.json()
      const ai = rows.find((r) => r.name === 'ai_responses') ?? rows[0]
      if (!ai) info('緊急停止', '行が無い（isAIEnabled は fail-open なので稼働中の扱い）')
      else if (ai.enabled === false)
        fail('緊急停止', 'AI が停止中', '管理画面で再開する。停止中は定型文しか返らない')
      else pass('緊急停止', '稼働中')
    } else {
      skip('緊急停止', `読めなかった（HTTP ${ks.status}）`)
    }

    // 件数だけを見る（中身は読まない）
    for (const [t, label] of [
      ['persons', '登録済みの生徒'],
      ['slack_channel_bindings', 'チャンネルの紐付け'],
    ]) {
      const res = await sb(`/rest/v1/${t}?select=id`, { headers: { Prefer: 'count=exact', Range: '0-0' } })
      const range = res.headers.get('content-range') ?? ''
      const total = range.split('/')[1] ?? ''
      if (!res.ok || total === '' || total === '*') {
        // 件数が読めなかったことを「0件ではない」と混同しない
        skip(label, `件数を確認できませんでした（HTTP ${res.status}）`)
        continue
      }
      if (total === '0')
        warn(label, '0 件', t === 'persons' ? '生徒を1人登録する（STEP 7）' : '生徒と Slack チャンネルを紐付ける（STEP 7）')
      else info(label, `${total} 件`)
    }

    // 管理画面に入れる人がいるか。
    // ⚠️ 1ページ目だけ見ると、200人を超える環境で admin を取りこぼして
    //    「admin が0人」と誤報する。最後まで辿る（invite-staff.mjs と同じ形）。
    const list = []
    let usersOk = true
    for (let page = 1; page <= 50; page += 1) {
      const res = await sb(`/auth/v1/admin/users?page=${page}&per_page=200`)
      if (!res.ok) {
        usersOk = false
        break
      }
      const body = await res.json()
      const chunk = body.users ?? []
      list.push(...chunk)
      if (chunk.length < 200) break
    }
    if (usersOk) {
      const admins = list.filter((u) => u.app_metadata?.role === 'admin')
      const staff = list.filter((u) => u.app_metadata?.role === 'staff')
      const noRole = list.filter((u) => !u.app_metadata?.role)
      if (list.length === 0)
        fail('管理ユーザー', '1人もいない', 'node scripts/invite-staff.mjs --email ... --role admin で作る')
      else if (admins.length === 0)
        fail('管理ユーザー', `${list.length} 人いるが admin が 0 人`, 'admin が1人は要る（緊急停止・紐付けの管理に必要）')
      else pass('管理ユーザー', `admin ${admins.length} 人 / staff ${staff.length} 人`)
      if (noRole.length > 0)
        warn('ロール未設定のユーザー', `${noRole.length} 人`, 'app_metadata.role が無いユーザーは権限判定で弾かれる。invite-staff.mjs で付け直す')
    } else {
      skip('管理ユーザー', '読めなかった')
    }
  }
}

// =============================================================================
// 3. Slack
// =============================================================================
setSection('3. Slack')

const slackToken = process.env.SLACK_BOT_TOKEN ?? ''
if (!slackToken) {
  skip('Bot Token', '未設定なので確認できません')
} else {
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${slackToken}` },
    })
    const body = await res.json()
    if (body.ok) {
      pass('Bot Token', `有効（team=${body.team}）`)
      const configured = process.env.SLACK_BOT_USER_ID
      if (configured && body.user_id && configured !== body.user_id) {
        fail(
          'SLACK_BOT_USER_ID の一致',
          'トークンの実際の Bot ユーザー ID と違う',
          'auth.test が返す user_id を SLACK_BOT_USER_ID に設定する。ズレていると自分の投稿に反応して無限ループになりうる',
        )
      } else if (configured) {
        pass('SLACK_BOT_USER_ID の一致', 'トークンの Bot ユーザーと一致')
      }
    } else {
      fail('Bot Token', `無効（${body.error}）`, 'Slack アプリの OAuth & Permissions から Bot Token を取り直す（STEP 4）')
    }
  } catch (e) {
    fail('Bot Token', `Slack へ到達できない（${e.code ?? e.name}）`, 'ネットワークを確認する')
  }
}

// =============================================================================
// 4. LLM
// =============================================================================
setSection('4. LLM')

const llmBase = (process.env.LLM_BASE_URL ?? '').replace(/\/$/, '')
const llmKey = process.env.LLM_API_KEY ?? ''
if (!llmBase || !llmKey) {
  skip('接続', 'LLM_BASE_URL か LLM_API_KEY が無いので確認できません')
} else {
  try {
    // 課金の発生しない models 一覧でキーの有効性を見る
    const res = await fetch(`${llmBase}/models`, { headers: { Authorization: `Bearer ${llmKey}` } })
    if (res.ok) {
      const body = await res.json()
      const ids = (body.data ?? []).map((m) => m.id)
      pass('API キー', `有効（モデル ${ids.length} 件が見える）`)
      for (const key of ['LLM_MODEL_DEFAULT', 'LLM_MODEL_COMPLEX']) {
        const model = process.env[key]
        if (!model) continue
        if (ids.length === 0) skip(`${key} の実在`, 'モデル一覧が空なので照合できません')
        else if (ids.includes(model)) pass(`${key} の実在`, `${model} が一覧にある`)
        else
          warn(
            `${key} の実在`,
            `${model} がモデル一覧に見当たらない`,
            'モデル名の綴り、またはプロバイダの名前空間（例 openai/gpt-4o）を確認する',
          )
      }
    } else {
      fail('API キー', `HTTP ${res.status}`, 'LLM_API_KEY と LLM_BASE_URL を確認する。残高切れでもここで落ちる')
    }
  } catch (e) {
    fail('接続', `到達できない（${e.code ?? e.name}）`, 'LLM_BASE_URL を確認する')
  }

  if (deep) {
    try {
      const res = await fetch(`${llmBase}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${llmKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.LLM_MODEL_DEFAULT,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      })
      if (res.ok) pass('実リクエスト（--deep）', '応答あり')
      else fail('実リクエスト（--deep）', `HTTP ${res.status}`, 'モデル名・パラメータ名がプロバイダと合っているか確認する')
    } catch (e) {
      fail('実リクエスト（--deep）', `失敗（${e.code ?? e.name}）`, '')
    }
  } else {
    skip('実リクエスト', '--deep を付けると1回だけ実際に投げます（課金あり・極小）')
  }
}

// =============================================================================
// 5. アプリと招待リンク
// =============================================================================
setSection('5. アプリ')

if (!appUrl) {
  skip('管理画面', '--app-url か環境変数 APP_URL が無いので確認できません')
} else {
  for (const path of ['/login', '/set-password']) {
    try {
      const res = await fetch(new URL(path, appUrl), { redirect: 'manual' })
      if (res.status === 200) pass(`${path} が開く`, `HTTP 200`)
      else warn(`${path} が開く`, `HTTP ${res.status}`, 'Vercel のデプロイが成功しているか確認する（STEP 5）')
    } catch (e) {
      fail(`${path} が開く`, `到達できない（${e.code ?? e.name}）`, 'APP_URL とデプロイ状態を確認する')
    }
  }

  // 招待リンクの着地先（ユーザーは作らない）
  if (supabaseUrl) {
    try {
      const redirectTo = new URL('/set-password', appUrl).toString()
      const probe =
        `${supabaseUrl}/auth/v1/verify?token=invalid-probe-${'0'.repeat(32)}` +
        `&type=recovery&redirect_to=${encodeURIComponent(redirectTo)}`
      const res = await fetch(probe, {
        method: 'GET',
        redirect: 'manual',
        headers: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
          ? { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }
          : {},
      })
      const loc = res.headers.get('location')
      if (!loc) {
        skip('招待リンクの着地先', 'Location が返らず判定できません')
      } else {
        const landed = new URL(loc)
        const expected = new URL(redirectTo)
        if (`${landed.origin}${landed.pathname}` === `${expected.origin}${expected.pathname}`) {
          pass('招待リンクの着地先', '/set-password に着地する')
        } else {
          fail(
            '招待リンクの着地先',
            `別の場所に着地する（${landed.origin}${landed.pathname}）`,
            `Supabase → Authentication → URL Configuration → Redirect URLs に ${redirectTo} を登録する。` +
              '未登録でもエラーにならず黙って Site URL に落ちるので気づけない',
          )
        }
      }
    } catch (e) {
      skip('招待リンクの着地先', `確認できません（${e.code ?? e.name}）`)
    }
  }
}

// =============================================================================
// 出力
// =============================================================================

console.log('')
console.log(bold('じゅくAI 導入チェック'))
console.log(dim('  書き込みは一切していません。秘密の値は表示していません。'))
console.log('')

let lastSection = ''
for (const r of results) {
  if (r.section !== lastSection) {
    console.log(bold(r.section))
    lastSection = r.section
  }
  const mark =
    r.ok === true ? green('  OK  ') : r.ok === null ? dim('  --  ') : r.level === 'required' ? red('  NG  ') : yellow('  推奨  ')
  console.log(`${mark} ${r.name}${r.detail ? dim(` … ${r.detail}`) : ''}`)
  if (r.ok === false && r.fix) console.log(`       ${dim('→ ' + r.fix)}`)
}

const ngRequired = results.filter((r) => r.ok === false && r.level === 'required')
const ngRecommended = results.filter((r) => r.ok === false && r.level === 'recommended')

console.log('')
console.log(
  `  必須 ${results.filter((r) => r.level === 'required').length} 項目中 ${red(String(ngRequired.length))} 件が不合格 / 推奨 ${yellow(String(ngRecommended.length))} 件が未設定`,
)
console.log('')

if (ngRequired.length > 0) {
  console.log(red('この環境はまだ塾で使えません。'))
  console.log('  上の NG を潰してから、もう一度このコマンドを実行してください。')
  process.exit(1)
}
console.log(green('必須項目はすべて通りました。'))
if (ngRecommended.length > 0) {
  console.log('  推奨の未設定があります。使えますが、上に書いた機能は動きません。')
}
console.log(dim('  最後に Slack で生徒役から1問投げて、返信が来ることを確かめてください（STEP 8）。'))
process.exit(0)
