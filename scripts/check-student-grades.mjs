#!/usr/bin/env node
/** @file
 * =============================================================================
 *  juku-ai-slack — 学年欄に氏名が混入していないかを点検する
 * =============================================================================
 *  ⚠️⚠️  このファイルは PUBLIC な GitHub リポジトリに置かれている  ⚠️⚠️
 *    キー・URL・氏名をこのファイルに書かないこと。すべて環境変数から読む。
 *
 *  なぜあるか（T-0097 ⑤）:
 *    `persons.grade`（学年）は **外部の LLM にそのまま送られる**
 *    （src/features/student-profiles/lib/getStudentProfile.ts の buildStudentNote）。
 *    一方 `persons.name`（氏名）は意図的に送らない設計になっている。
 *    つまりスタッフが学年欄に「中3 山田」と書くと、**氏名だけが設計の穴から外部へ出る**。
 *    登録画面には注意書きがあるが、注意書きは守られないことがある。だから機械で見る。
 *
 *  方針（inspections/コード.md の教訓を適用）:
 *    **既定は「要確認」。** 「氏名っぽい文字列を列挙して弾く」（ブラックリスト）は必ず漏れる。
 *    「純粋な学年表記だと積極的に判断できたものだけ OK」（許可リスト）にする。
 *    漏れたときに過剰検出（人が1件見れば済む）に倒れる方を選ぶ。
 *
 *  出力について（プライバシー）:
 *    **学年欄の中身も氏名も一切表示しない。** 出すのは件数と、要確認の行の id・文字数・
 *    文字種の内訳だけ。ログに貼っても実データが漏れない形にしてある。
 *
 *  使い方:
 *    node scripts/check-student-grades.mjs
 *    node scripts/check-student-grades.mjs --env-file .env.local
 *    node scripts/check-student-grades.mjs --show-shape   # 文字種の並びも出す（値は出さない）
 *
 *  終了コード: 0=全件OK / 1=要確認あり / 2=実行できなかった
 * =============================================================================
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `学年欄（persons.grade）に氏名が混入していないかを点検する。
学年欄の中身も氏名も表示しない（件数と文字種だけを出す）。

  node scripts/check-student-grades.mjs [--env-file <path>] [--show-shape]

  --env-file <path>  環境変数を読むファイル（既定 .env.local）
  --show-shape       要確認の行について、文字種の並びも出す（値そのものは出さない）
  --help             このヘルプ

  環境変数: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
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

/**
 * 「純粋な学年表記」だと積極的に判断できるものだけを通す許可リスト。
 * ここに無いものは危険だと決めつけず、**人が1件見る**ために「要確認」へ回す。
 *
 * 全角数字は半角へ、全角スペースは半角へ正規化してから判定する
 * （判定を迂回されないよう、比較の前に実行系と同じ正規化を自分でやる）。
 */
const GRADE_ALLOW = [
  /^小[1-6]$/,
  /^中[1-3]$/,
  /^高[1-3]$/,
  /^小学[1-6]年(生)?$/,
  /^中学[1-3]年(生)?$/,
  /^高校[1-3]年(生)?$/,
  /^[1-6]年(生)?$/,
  /^(既卒|浪人|高卒|社会人|未設定)$/,
  /^[1-6]$/,
]

function normalize(s) {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .trim()
}

/** 文字種の並びを要約する。値そのものは決して返さない */
function shapeOf(s) {
  const cls = (c) => {
    if (/[0-9]/.test(c)) return '数'
    if (/\s/.test(c)) return '空白'
    if (/[぀-ゟ]/.test(c)) return 'ひらがな'
    if (/[゠-ヿ]/.test(c)) return 'カタカナ'
    if (/[一-鿿]/.test(c)) return '漢字'
    if (/[A-Za-z]/.test(c)) return '英字'
    return '記号'
  }
  const runs = []
  for (const ch of s) {
    const k = cls(ch)
    if (runs.length && runs[runs.length - 1].k === k) runs[runs.length - 1].n += 1
    else runs.push({ k, n: 1 })
  }
  return runs.map((r) => `${r.k}×${r.n}`).join(' + ')
}

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}
const showShape = argv.includes('--show-shape')
const envFileIdx = argv.indexOf('--env-file')

loadEnvFile(envFileIdx >= 0 ? argv[envFileIdx + 1] : '.env.local')

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です（.env.local か環境変数）。',
  )
  process.exit(2)
}

// grade と id だけを取る。name は取得しない（氏名をこのプロセスに載せない）。
// ⚠️ PostgREST には既定の返却上限がある。**黙って途中までしか見ないと、
//    点検したつもりで未点検の生徒が残る**（この手の検査で最も危ない失敗）。
//    件数を先に取り、取得できた行数と一致するまでページを進める。
const PAGE = 1000
const rows = []
let expected = null
for (let offset = 0; ; offset += PAGE) {
  const res = await fetch(`${supabaseUrl}/rest/v1/persons?select=id,grade,status`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'count=exact',
      Range: `${offset}-${offset + PAGE - 1}`,
    },
  })
  if (!res.ok && res.status !== 206) {
    console.error(`persons の取得に失敗しました (HTTP ${res.status})`)
    process.exit(2)
  }
  const total = (res.headers.get('content-range') ?? '').split('/')[1]
  if (expected === null && total && total !== '*') expected = Number(total)
  const chunk = await res.json()
  rows.push(...chunk)
  if (chunk.length < PAGE) break
}

if (expected !== null && rows.length !== expected) {
  console.error(
    `取得できた生徒が ${rows.length} 件で、DB 上の ${expected} 件と一致しません。\n` +
      '点検漏れが出るため中止します。時間をおいて再実行してください。',
  )
  process.exit(2)
}

const empty = []
const ok = []
const review = []

for (const row of rows) {
  const raw = row.grade
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    empty.push(row)
    continue
  }
  const value = normalize(String(raw))
  if (GRADE_ALLOW.some((re) => re.test(value))) ok.push(row)
  else review.push({ id: row.id, status: row.status, len: [...value].length, shape: shapeOf(value) })
}

console.log('学年欄（persons.grade）の点検')
console.log('  学年欄は外部の LLM に送られます。氏名は送らない設計なので、ここに氏名を書くと')
console.log('  氏名だけが外へ出ます（getStudentProfile.ts の buildStudentNote）。')
console.log('')
console.log(`  生徒の総数        : ${rows.length}`)
console.log(`  学年が未入力      : ${empty.length}（送るものが無いので問題なし）`)
console.log(`  純粋な学年表記    : ${ok.length}`)
console.log(`  要確認            : ${review.length}`)
console.log('')

if (review.length === 0) {
  console.log('判定: ✅ 氏名の混入は見つかりませんでした。')
  process.exit(0)
}

console.log('判定: ⚠️ 人の目で1件ずつ確認してください。')
console.log('  （「純粋な学年表記だと確信できないもの」を全部ここに出しています。')
console.log('    氏名とは限りません。「中3・数学コース」のような書き方も入ります）')
console.log('')
for (const r of review) {
  console.log(`  - person id: ${r.id}  status=${r.status}  文字数=${r.len}`)
  if (showShape) console.log(`      文字種: ${r.shape}`)
}
console.log('')
console.log('  確認のしかた: 管理画面 → 生徒一覧 → 該当の生徒 → 学年欄を開き、')
console.log('  氏名が入っていれば学年だけに直してください（例「中3 山田」→「中3」）。')
process.exit(1)
