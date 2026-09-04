#!/usr/bin/env node
/** @file
 * 機能: スタッフマニュアル（docs/08_スタッフマニュアル/）に貼る実画面のスクリーンショットを撮る
 * 入力: ローカル Supabase（5434x 帯）+ .env.test / .env.test.example
 * 出力: docs/08_スタッフマニュアル/images/*.png
 * 依存: @playwright/test（chromium）, @supabase/supabase-js, e2e/acceptance/mock-server.mjs
 * 副作用: 一時的にサンプルデータを DB に入れ、撮影後に必ず消して元の行を復元する
 *
 * 使い方:
 *   pnpm build            # .next が古いときだけ（E2E と同じ本番ビルドを配信する）
 *   node scripts/capture-manual-screenshots.mjs
 *
 * 設計メモ:
 *  - Playwright の MCP は使わない。E2E と同じ「モックサーバー + next start」を自前で立てる。
 *    実 Slack / 実 LLM は 1 度も呼ばない（SLACK_API_BASE_URL / LLM_BASE_URL がモックを向く）。
 *  - 管理画面は `h-screen overflow-hidden` + `main.overflow-y-auto` なので fullPage が効かない。
 *    そのため「中身の高さを測ってビューポートを伸ばしてから撮る」方式を取る（fitViewport）。
 *  - 撮影前に既存行（seed.sql の テスト太郎 など）を退避して消す。マニュアルに
 *    `<REPLACE_CHANNEL_ID>` のようなプレースホルダが写らないようにするため。
 *    退避した行は最後に created_at ごと復元し、件数と内容を照合する。
 *  - 生徒名・メールアドレス・チャンネル ID はすべて架空。example.com は
 *    ドキュメント用予約ドメイン（RFC 2606）。
 */
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { loadTestEnv } from './test-env.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(repoRoot, 'docs/08_スタッフマニュアル/images')
// 退避先はリポジトリ外（git status を汚さない）
const BACKUP_PATH = join(tmpdir(), 'manual-shots-db-backup.json')

const testEnv = loadTestEnv()
const PORT = process.env.SHOT_PORT ?? '3410'
const MOCK_PORT = process.env.SHOT_MOCK_PORT ?? '3461'
const BASE = `http://localhost:${PORT}`
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET
const BOT_USER_ID = process.env.SLACK_BOT_USER_ID ?? 'U0E2EBOTUSER'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
  process.exit(2)
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** 撮影用の一時管理者。撮影後に削除する（E2E の恒久ユーザーとは別） */
const SHOOT_USER = { email: 'staff@example.com', password: 'Manual-Shot-Passw0rd!' }

/** 退避・削除の対象。削除はこの順（FK の子から親へ） */
const TABLES_CHILD_FIRST = [
  'attachments',
  'report_chunks',
  'ai_usage_logs',
  'ai_error_logs',
  'slack_messages',
  'slack_thread_sessions',
  'student_episodic_memories',
  'student_knowledge_states',
  'student_profiles',
  'jobs',
  'slack_event_receipts',
  'slack_channel_bindings',
  'reports',
  'persons',
]

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

// --- 架空のサンプルデータ -----------------------------------------------------

const TEAM_ID = 'T08JUKU2026'
const P1 = { id: '11111111-1111-4111-8111-111111111101', name: '山田 太郎', display_name: 'たろう', grade: '中学2年', status: 'active', guardian_email: 'taro.guardian@example.com' }
const P2 = { id: '11111111-1111-4111-8111-111111111102', name: '佐藤 花子', display_name: 'はなこ', grade: '中学3年', status: 'active', guardian_email: 'hanako.guardian@example.com' }
const P3 = { id: '11111111-1111-4111-8111-111111111103', name: '鈴木 健一', display_name: null, grade: '高校1年', status: 'inactive', guardian_email: null }
const CH1 = 'C08TARO2026'
const CH2 = 'C08HANA2026'
const REPORT_A = '22222222-2222-4222-8222-222222222201'
const REPORT_B = '22222222-2222-4222-8222-222222222202'
const REPORT_C = '22222222-2222-4222-8222-222222222203'

const REPORT_A_BODY = `## 今月のまとめ

一次関数の式の立て方が安定してきました。グラフの読み取りも、傾きと切片を
先に確認する手順が身につきつつあります。

## できるようになったこと

- 一次関数の式を 2 点から求める（正答率 8 割）
- 連立方程式の加減法（計算ミスが月初の 5 件 → 1 件に減少）
- 英語の不定詞（名詞的用法）の書き換え

## 課題

- 文章題で「何を x にするか」を決めるまでに時間がかかる
- 図形の証明で、根拠として使う定理の名前を書き落とす
- 英単語の綴り（-ing / -ed の変化）

## 来月の重点

1. 文章題を「条件を線分図に置き換える」手順で 10 問通す
2. 三角形の合同条件を口頭で言えるようにする
3. 単語テストを週 2 回に増やす`

const REPORT_B_BODY = `## 今月のまとめ

受験に向けて、理科（化学変化）と社会（近現代史）の底上げを進めました。
数学は関数の応用で得点が伸びています。

## できるようになったこと

- 二次関数と直線の交点を求める（模試で 2 問中 2 問正答）
- 化学反応式の係数合わせ
- 長文読解で段落ごとの要旨をメモしながら読む習慣

## 課題

- 記述問題で、結論を先に書かず途中で止まってしまう
- 歴史の年号を単独で覚えようとして定着しない
- 時間配分（大問 4 に手が回らない）

## 来月の重点

1. 記述は「結論 → 理由」の順で書く型を 20 問で練習
2. 出来事をつなげた流れで覚え直す
3. 過去問を時間を計って 2 回`

const REPORT_C_BODY = `## 今月のまとめ（下書き）

※ 面談前に加筆する。模試の結果が返ってきてから数値を入れる。

## 気づいたこと

- 質問の内容が「解法を聞く」から「自分の解き方の確認」に変わってきた
`

const PROFILE_P1 = {
  person_id: P1.id,
  summary:
    '中学2年。数学は正負の数と文字式の計算は安定しているが、一次関数の文章題で「何を x にするか」を決めるまでに時間がかかる。英語は単語量が増えてきた一方、be動詞と一般動詞の混在する疑問文で語順が崩れることがある。週2回（火・金）通塾。定期テスト前は自習室の利用が多い。',
  learning_style:
    '図やグラフを描いて説明すると理解が早い。長い説明は読み飛ばしがちなので、要点を先に短く出す。',
  strengths: '計算の正確さ。同じ形式の問題を繰り返す練習に前向き。図形の作図が丁寧。',
  weaknesses:
    '文章題の条件整理。図形の証明で根拠となる定理名を書き落とす。英単語の綴り（-ing / -ed の変化）。',
  instruction_notes:
    '間違いを指摘されると口数が減るので、まず合っている部分を先に伝える。部活の大会前は演習量を抑える。',
  exam_subjects: ['数学', '英語', '理科'],
}

const PROFILE_P2 = {
  person_id: P2.id,
  summary:
    '中学3年。受験に向けて数学の関数分野は得点源になりつつある。理科（化学変化）と社会（近現代史）に伸びしろがある。記述問題で結論を後回しにする癖がある。',
  learning_style: '言葉で筋道を立てて説明するのが得意。まず自分の考えを言わせてから補足するとよい。',
  strengths: '関数の応用問題。長文読解の要旨把握。',
  weaknesses: '記述の書き出し。歴史の出来事のつながり。試験の時間配分。',
  instruction_notes: '志望校の話題は本人から出たときだけ触れる。',
  exam_subjects: null,
}

// --- 小道具 -------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isoDaysAgo(days, hour = 16, minute = 20) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  d.setUTCHours(hour, minute, 0, 0)
  return d.toISOString()
}

function isoMinutesAgo(min) {
  return new Date(Date.now() - min * 60_000).toISOString()
}

async function waitForUrl(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
    } catch {
      /* まだ起動していない */
    }
    await sleep(300)
  }
  throw new Error(`${label} が ${timeoutMs}ms 以内に起動しませんでした（${url}）`)
}

// --- サーバー起動 -------------------------------------------------------------

const children = []

function startServers() {
  const binDir = join(repoRoot, 'node_modules', '.bin')
  const baseEnv = { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` }

  children.push(
    spawn('node', ['e2e/acceptance/mock-server.mjs'], {
      cwd: repoRoot,
      env: { ...baseEnv, MOCK_PORT },
      stdio: ['ignore', 'ignore', 'inherit'],
    }),
  )

  children.push(
    spawn('next', ['start', '--port', PORT], {
      cwd: repoRoot,
      env: {
        ...baseEnv,
        ...testEnv,
        SLACK_API_BASE_URL: `${MOCK_BASE}/slack`,
        LLM_BASE_URL: `${MOCK_BASE}/llm`,
        // エラー詳細・ジョブ一覧の「Slack で開く」リンクを出すための架空ワークスペース
        SLACK_WORKSPACE_URL: 'https://juku-example.slack.com',
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    }),
  )
}

function stopServers() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
}

// --- DB 退避 / 復元 -----------------------------------------------------------

async function snapshot() {
  const data = {}
  for (const table of TABLES_CHILD_FIRST) {
    const { data: rows, error } = await db.from(table).select('*')
    if (error) throw new Error(`退避に失敗 ${table}: ${error.message}`)
    data[table] = rows ?? []
  }
  writeFileSync(BACKUP_PATH, JSON.stringify(data, null, 1), 'utf8')
  const total = Object.values(data).reduce((n, rows) => n + rows.length, 0)
  console.log(`[db] 既存 ${total} 行を退避 → ${BACKUP_PATH}`)
  return data
}

async function deleteAll() {
  for (const table of TABLES_CHILD_FIRST) {
    const { error } = await db.from(table).delete().neq('id', ZERO_UUID)
    if (error) throw new Error(`削除に失敗 ${table}: ${error.message}`)
  }
}

async function restore(snap) {
  for (const table of [...TABLES_CHILD_FIRST].reverse()) {
    const rows = snap[table]
    if (!rows || rows.length === 0) continue
    const { error } = await db.from(table).insert(rows)
    if (error) throw new Error(`復元に失敗 ${table}: ${error.message}`)
    console.log(`[db] 復元 ${table}: ${rows.length} 行`)
  }
}

async function verifyRestored(snap) {
  const problems = []
  for (const table of TABLES_CHILD_FIRST) {
    const { data: rows, error } = await db.from(table).select('*')
    if (error) {
      problems.push(`${table}: 照合クエリ失敗 ${error.message}`)
      continue
    }
    const before = JSON.stringify([...(snap[table] ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id))))
    const after = JSON.stringify([...(rows ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id))))
    if (before !== after) {
      problems.push(`${table}: 退避 ${snap[table]?.length ?? 0} 行 / 現在 ${rows?.length ?? 0} 行（内容不一致）`)
    }
  }
  return problems
}

// --- サンプルデータ投入 -------------------------------------------------------

async function insert(table, rows) {
  const { error } = await db.from(table).insert(rows)
  if (error) throw new Error(`投入に失敗 ${table}: ${error.message}`)
}

async function seedBase() {
  await insert('persons', [
    { ...P1, created_at: isoDaysAgo(96, 2, 10), updated_at: isoDaysAgo(96, 2, 10) },
    { ...P2, created_at: isoDaysAgo(96, 2, 12), updated_at: isoDaysAgo(96, 2, 12) },
    { ...P3, created_at: isoDaysAgo(420, 3, 5), updated_at: isoDaysAgo(30, 3, 5) },
  ])

  // 試験期間の最終日は「今日 + 7 日」（JST の暦日いっぱいまで有効 = 翌日 00:00 JST）
  const examEnd = new Date()
  examEnd.setUTCDate(examEnd.getUTCDate() + 7)
  const examEndDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(examEnd)

  await insert('student_profiles', [
    { ...PROFILE_P1, exam_mode_until: `${examEndDate}T15:00:00.000Z`, updated_at: isoDaysAgo(3, 1, 30) },
    { ...PROFILE_P2, exam_mode_until: null, updated_at: isoDaysAgo(12, 5, 45) },
  ])

  const reportUpdated = isoDaysAgo(4, 3, 15)
  await insert('reports', [
    {
      id: REPORT_A,
      person_id: P1.id,
      title: `${new Date().getFullYear()}年8月 学習レポート`,
      report_month: `${new Date().getFullYear()}-08-01`,
      body_markdown: REPORT_A_BODY,
      status: 'approved',
      is_ai_reference: true,
      // 帯に「最終 Embedding: 日時」が出る状態（updated_at より後）
      embeddings_updated_at: isoDaysAgo(4, 3, 18),
      created_at: isoDaysAgo(6, 2, 0),
      updated_at: reportUpdated,
    },
    {
      id: REPORT_B,
      person_id: P2.id,
      title: `${new Date().getFullYear()}年8月 学習レポート`,
      report_month: `${new Date().getFullYear()}-08-01`,
      body_markdown: REPORT_B_BODY,
      status: 'approved',
      is_ai_reference: true,
      // 本文の更新より古い = 「Embedding 再生成が必要です」の警告が出る状態
      embeddings_updated_at: isoDaysAgo(9, 4, 0),
      created_at: isoDaysAgo(9, 3, 0),
      updated_at: isoDaysAgo(2, 6, 40),
    },
    {
      id: REPORT_C,
      person_id: P2.id,
      title: `${new Date().getFullYear()}年9月 学習レポート`,
      report_month: `${new Date().getFullYear()}-09-01`,
      body_markdown: REPORT_C_BODY,
      status: 'draft',
      is_ai_reference: false,
      embeddings_updated_at: null,
      created_at: isoDaysAgo(1, 7, 10),
      updated_at: isoDaysAgo(1, 7, 10),
    },
  ])

  await insert('slack_channel_bindings', [
    {
      slack_team_id: TEAM_ID,
      slack_channel_id: CH1,
      slack_channel_name: 'study-yamada',
      person_id: P1.id,
      default_report_id: REPORT_A,
      status: 'active',
      created_at: isoDaysAgo(95, 2, 30),
      updated_at: isoDaysAgo(6, 2, 30),
    },
    {
      slack_team_id: TEAM_ID,
      slack_channel_id: CH2,
      slack_channel_name: 'study-sato',
      person_id: P2.id,
      default_report_id: null,
      status: 'active',
      created_at: isoDaysAgo(95, 2, 35),
      updated_at: isoDaysAgo(9, 2, 35),
    },
  ])
}

/**
 * 本番の LLM_MODEL_DEFAULT / LLM_MODEL_COMPLEX（constants.ts の MODEL_PRICING に単価がある）。
 * ここを単価未登録のモデル名にすると「価格未設定のモデル」警告が画面に出る。
 */
const MODEL_DEFAULT = 'openai/gpt-5.6-luna'
const MODEL_COMPLEX = 'openai/gpt-5.6-terra'
const PRICE_PER_M = {
  [MODEL_DEFAULT]: { input: 0.2, output: 1.2 },
  [MODEL_COMPLEX]: { input: 2.0, output: 12.0 },
}

function usageCost(model, inTok, outTok) {
  const p = PRICE_PER_M[model]
  return Number(((inTok * p.input + outTok * p.output) / 1_000_000).toFixed(6))
}

/** 利用状況・ダッシュボードのグラフと数値を「使われている塾」に見せるための実績ログ */
async function seedUsage() {
  const rows = []
  let seq = 0
  const plan = [
    { person: P1, channel: CH1 },
    { person: P2, channel: CH2 },
  ]
  for (let day = 29; day >= 0; day--) {
    for (const { person, channel } of plan) {
      // 平日は多め・日曜は少なめ、を素朴に再現する
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - day)
      const dow = d.getUTCDay()
      const base = dow === 0 ? 1 : dow === 6 ? 2 : 3
      const count = base + ((day + (person === P1 ? 0 : 1)) % 3)
      for (let i = 0; i < count; i++) {
        seq += 1
        // 画像付きの質問は Vision 対応モデル（COMPLEX）に回る
        const hasImage = seq % 7 === 0
        const model = hasImage ? MODEL_COMPLEX : MODEL_DEFAULT
        // プロンプトには AI 用プロフィールとレポート抜粋が載るので入力が大きい
        const inTok = (hasImage ? 8200 : 5200) + ((seq * 137) % 2400)
        const outTok = (hasImage ? 900 : 520) + ((seq * 71) % 620)
        rows.push({
          person_id: person.id,
          slack_channel_id: channel,
          thread_ts: `sample.${day}.${i}.${person === P1 ? 'a' : 'b'}`,
          message_ts: `sample.${day}.${i}.${person === P1 ? 'a' : 'b'}`,
          model,
          input_tokens: inTok,
          output_tokens: outTok,
          total_tokens: inTok + outTok,
          estimated_cost: usageCost(model, inTok, outTok),
          has_image: hasImage,
          latency_ms: 3200 + ((seq * 53) % 2600),
          created_at: isoDaysAgo(day, 8 + (i % 6), (seq * 13) % 60),
        })
      }
    }
  }
  await insert('ai_usage_logs', rows)
  console.log(`[db] 利用実績 ${rows.length} 行`)
}

async function seedErrors() {
  await insert('ai_error_logs', [
    {
      error_code: 'AI_TIMEOUT',
      severity: 'error',
      provider: 'openai',
      person_id: P1.id,
      slack_channel_id: CH1,
      thread_ts: '1756900000.100200',
      message_ts: '1756900000.100200',
      user_facing_message:
        '回答の生成に時間がかかりすぎてしまった。質問を少し短くしてもう一度送ってみてね。',
      internal_message:
        'AI response timed out\n  provider=openai model=openai/gpt-5.6-luna\n  elapsed=60021ms limit=60000ms\n  thread_ts=1756900000.100200',
      retryable: true,
      resolved: false,
      created_at: isoMinutesAgo(95),
      updated_at: isoMinutesAgo(95),
    },
    {
      error_code: 'SLACK_POST_FAILED',
      severity: 'error',
      provider: 'slack',
      person_id: P2.id,
      slack_channel_id: CH2,
      thread_ts: '1756880000.400500',
      message_ts: '1756880000.400500',
      user_facing_message: null,
      internal_message: 'Failed to post Slack message\n  slack_error=not_in_channel channel=C08HANA2026',
      retryable: false,
      resolved: false,
      created_at: isoMinutesAgo(240),
      updated_at: isoMinutesAgo(240),
    },
    {
      error_code: 'IMAGE_TOO_LARGE',
      severity: 'warning',
      provider: null,
      person_id: P1.id,
      slack_channel_id: CH1,
      thread_ts: '1756820000.700800',
      message_ts: '1756820000.700800',
      user_facing_message: '画像が少し大きすぎたみたい。圧縮してもう一度送ってみてね！',
      internal_message: 'Image too large: 12874311 bytes (limit 10485760)',
      retryable: false,
      resolved: true,
      notes: '生徒に「写真は Slack の圧縮を有効にして送る」よう伝えた。再発なし。',
      created_at: isoMinutesAgo(1580),
      updated_at: isoMinutesAgo(1500),
    },
    {
      error_code: 'RATE_LIMITED',
      severity: 'info',
      provider: null,
      person_id: P1.id,
      slack_channel_id: CH1,
      thread_ts: '1756810000.900100',
      message_ts: '1756810000.900100',
      user_facing_message:
        '今日はたくさん質問してくれてありがとう！ちょっと休憩して、1時間ほどしてからまた質問してね :relaxed:',
      internal_message: 'person rate limit reached: 10 questions / 1h',
      retryable: false,
      resolved: false,
      created_at: isoMinutesAgo(1700),
      updated_at: isoMinutesAgo(1700),
    },
  ])
}

async function seedJobs() {
  await insert('jobs', [
    {
      job_type: 'process_slack_message',
      status: 'failed',
      payload: {
        eventId: 'EvSAMPLEFAILED1',
        channelId: CH1,
        threadTs: '1756900000.100200',
        messageTs: '1756900000.100200',
        personId: P1.id,
      },
      attempt_count: 3,
      max_attempts: 3,
      error_code: 'AI_TIMEOUT',
      started_at: isoMinutesAgo(96),
      finished_at: isoMinutesAgo(95),
      created_at: isoMinutesAgo(97),
      updated_at: isoMinutesAgo(95),
    },
    {
      job_type: 'process_slack_message',
      status: 'failed',
      payload: {
        eventId: 'EvSAMPLEFAILED2',
        channelId: CH2,
        threadTs: '1756880000.400500',
        messageTs: '1756880000.400500',
        personId: P2.id,
      },
      attempt_count: 1,
      max_attempts: 3,
      error_code: 'SLACK_POST_FAILED',
      started_at: isoMinutesAgo(241),
      finished_at: isoMinutesAgo(240),
      created_at: isoMinutesAgo(242),
      updated_at: isoMinutesAgo(240),
    },
    {
      job_type: 'process_slack_message',
      status: 'processing',
      payload: {
        eventId: 'EvSAMPLEPROCESSING',
        channelId: CH2,
        threadTs: '1756990000.111000',
        messageTs: '1756990000.111000',
        personId: P2.id,
      },
      attempt_count: 1,
      max_attempts: 3,
      started_at: isoMinutesAgo(2),
      created_at: isoMinutesAgo(2),
      updated_at: isoMinutesAgo(2),
    },
    {
      job_type: 'process_slack_message',
      status: 'pending',
      payload: {
        eventId: 'EvSAMPLEPENDING',
        channelId: CH1,
        threadTs: '1756990100.222000',
        messageTs: '1756990100.222000',
        personId: P1.id,
      },
      attempt_count: 0,
      max_attempts: 3,
      created_at: isoMinutesAgo(1),
      updated_at: isoMinutesAgo(1),
    },
  ])
}

// --- Slack フロー（モックサーバー経由で 1 スレッド分の会話ログを作る）--------

let tsCounter = 0
function nowTs() {
  const now = Date.now()
  tsCounter = (tsCounter + 1) % 1000
  return `${Math.floor(now / 1000)}.${String((now % 1000) * 1000 + tsCounter).padStart(6, '0')}`
}

function slackSign(rawBody, timestamp) {
  return `v0=${createHmac('sha256', SIGNING_SECRET).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`
}

function buildEventCallback({ eventId, channel, ts, text, threadTs }) {
  const event = { type: 'message', channel, ts, user: 'U08STUDENT1', text }
  if (threadTs) event.thread_ts = threadTs
  return JSON.stringify({ type: 'event_callback', event_id: eventId, team_id: TEAM_ID, event })
}

async function postSlackEvent(rawBody, { signature } = {}) {
  const ts = String(Math.floor(Date.now() / 1000))
  const res = await fetch(`${BASE}/api/slack/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': signature ?? slackSign(rawBody, ts),
    },
    body: rawBody,
  })
  return res
}

async function waitForPosts(channel, min) {
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    const res = await fetch(`${MOCK_BASE}/__mock/calls?kind=slack&method=chat.postMessage&channel=${channel}`)
    const { count } = await res.json()
    if (count >= min) return count
    await sleep(300)
  }
  throw new Error(`モック Slack への投稿が ${min} 件に達しませんでした（${channel}）`)
}

/**
 * 実際の受信経路（署名検証 → ジョブ → LLM → Slack 投稿）を 2 往復通す。
 * モック LLM の返答は固定文（「モックLLMの回答です…」）なので、
 * 会話ログに写る本文だけ、あとから塾の指導内容らしい文面へ差し替える。
 */
async function runSlackFlow() {
  const rootTs = nowTs()
  const q1 = '一次関数の文章題で、何を x にすればいいのか毎回迷ってしまいます。決め方のコツはありますか？'
  const q2 = 'なるほど。速さの問題だと、時間を x にするか道のりを x にするか、どっちがいいですか？'

  let res = await postSlackEvent(
    buildEventCallback({
      eventId: 'EvMANUALSHOT1',
      channel: CH1,
      ts: rootTs,
      text: `<@${BOT_USER_ID}> ${q1}`,
    }),
  )
  if (res.status !== 200) throw new Error(`Slack イベント 1 の ACK が ${res.status}`)
  await waitForPosts(CH1, 1)

  res = await postSlackEvent(
    buildEventCallback({
      eventId: 'EvMANUALSHOT2',
      channel: CH1,
      ts: nowTs(),
      threadTs: rootTs,
      text: q2,
    }),
  )
  if (res.status !== 200) throw new Error(`Slack イベント 2 の ACK が ${res.status}`)
  await waitForPosts(CH1, 2)
  // ジョブの後処理（usage ログ・セッション更新）が落ち着くのを待つ
  await sleep(1500)

  const a1 = `まず「聞かれているもの」を x にするのが基本だよ。文章の最後の一文をもう一度読んで、
「〜は何分ですか」「〜は何 km ですか」のどれを答えるのかを指さしてみて。

そのうえで、こう進めるといい。

1. 問題文の数と単位を線分図か表に書き出す
2. 答えを聞かれているものに x を置く
3. 「等しくなっているもの」を 1 つ見つけて式にする

3 の「等しくなっているもの」は、合計・差・同じ時間・同じ道のり のどれかがほとんどだよ。
まずは 1 問、線分図を書くところまでやって見せてくれる？`
  const a2 = `いい質問！速さの問題は「等しくなっているもの」から逆算すると決めやすいよ。

・出発から出会うまでの「時間が同じ」なら → 時間を x にする
・行きと帰りで「道のりが同じ」なら → 道のりを x にする

つまり、先に「どれが同じか」を見つけてから x を決める順番。
逆にすると式が作れなくて手が止まるんだ。

さっきの問題は「2人が出会う」タイプだから、時間を x にしてみよう。`

  const { data: msgs, error } = await db
    .from('slack_messages')
    .select('id, role, message_ts')
    .eq('slack_channel_id', CH1)
    .order('message_ts', { ascending: true })
  if (error) throw new Error(`会話ログの取得に失敗: ${error.message}`)
  const user = msgs.filter((m) => m.role === 'user')
  const bot = msgs.filter((m) => m.role === 'assistant')
  if (user.length < 2 || bot.length < 2) {
    throw new Error(`会話ログが揃っていません（user=${user.length} assistant=${bot.length}）`)
  }

  const texts = [
    [user[0].id, q1],
    [bot[0].id, a1],
    [user[1].id, q2],
    [bot[1].id, a2],
  ]
  for (const [id, text] of texts) {
    const up = await db.from('slack_messages').update({ text }).eq('id', id)
    if (up.error) throw new Error(`会話ログ本文の差し替えに失敗: ${up.error.message}`)
  }

  // 短いスレッドでは要約が生成されないので、一覧の「概要」列に出る文面を入れておく
  const sess = await db
    .from('slack_thread_sessions')
    .update({
      thread_summary:
        '一次関数の文章題で x の置き方に迷うという相談。聞かれているものを x にする手順と、速さの問題では「同じもの」から先に決める考え方を確認した。',
      summary_message_count: 4,
    })
    .eq('slack_channel_id', CH1)
  if (sess.error) throw new Error(`スレッド要約の設定に失敗: ${sess.error.message}`)

  // モックのモデル名（mock/tutor-model）が画面に残らないよう単価のあるモデル名へ揃える
  const norm = await db
    .from('ai_usage_logs')
    .update({ model: MODEL_DEFAULT })
    .eq('model', 'mock/tutor-model')
  if (norm.error) throw new Error(`モデル名の正規化に失敗: ${norm.error.message}`)

  // 署名不正のリクエストを 1 件投げて、実経路のエラーログ（SLACK_SIGNATURE_INVALID）を作る
  await postSlackEvent(
    buildEventCallback({ eventId: 'EvMANUALSHOTBAD', channel: CH1, ts: nowTs(), text: 'bad signature' }),
    { signature: 'v0=0000000000000000000000000000000000000000000000000000000000000000' },
  )
  await sleep(800)

  // EMBEDDING_BASE_URL を到達しない URL に向けているテスト環境だけで出るログ。
  // 本番では起きないので、マニュアルのエラー一覧には載せない
  const drop = await db
    .from('ai_error_logs')
    .delete()
    .eq('error_code', 'REPORT_CHUNK_SEARCH_FAILED')
  if (drop.error) throw new Error(`環境依存エラーログの除去に失敗: ${drop.error.message}`)

  return { rootTs }
}

/**
 * 会話ログ一覧を「複数スレッドが並んだ状態」にするための追加サンプル。
 * 一覧の列（概要 / 件数 / 画像・エラーのアイコン）が 1 行だけでは伝わらないため、
 * 画像付きスレッドとエラーが起きたスレッドを 1 つずつ足す。
 */
async function seedExtraThreads() {
  const satoThread = '1756927800.120300'
  // AI_TIMEOUT のエラーログと同じ thread_ts。一覧の「状態」にエラーアイコンが出る
  const timeoutThread = '1756900000.100200'

  await insert('slack_thread_sessions', [
    {
      slack_team_id: TEAM_ID,
      slack_channel_id: CH2,
      root_message_ts: satoThread,
      thread_ts: satoThread,
      person_id: P2.id,
      status: 'active',
      thread_summary:
        '化学変化の記述問題について。ノートの写真を送って、係数の合わせ方と「質量保存の法則」を答案に書く順番を確認した。',
      summary_message_count: 6,
      created_at: isoMinutesAgo(215),
      updated_at: isoMinutesAgo(198),
      last_message_at: isoMinutesAgo(198),
    },
    {
      slack_team_id: TEAM_ID,
      slack_channel_id: CH1,
      root_message_ts: timeoutThread,
      thread_ts: timeoutThread,
      person_id: P1.id,
      status: 'active',
      thread_summary: null,
      summary_message_count: 0,
      created_at: isoMinutesAgo(96),
      updated_at: isoMinutesAgo(96),
      last_message_at: isoMinutesAgo(96),
    },
  ])

  const satoMsgs = [
    ['user', 'この問題の答案、これで合ってますか？ノートの写真を送ります。', true],
    [
      'assistant',
      `写真ありがとう！式は合っているよ。惜しいのは 2 つ。

1. 係数の 2 が右辺だけについている（左辺の水素も 2 倍が必要）
2. 「質量保存の法則より」の一言が答案に無い

記述は「法則の名前 → 式 → 結論」の順で書くと点が安定するよ。`,
      false,
    ],
    ['user', '係数って、どこから合わせ始めるのがいいですか？', false],
    [
      'assistant',
      `いちばん種類の多い原子から合わせるのがコツだよ。この式なら酸素から。

酸素 → 水素 → 最後に単体（H2 など）の順に整えると、やり直しが少なくなる。`,
      false,
    ],
    ['user', 'やってみたら合いました！ありがとうございます。', false],
    ['assistant', 'いいね、その順番が身につけば記述でも迷わなくなるよ。次は演習問題 4 でもう一度試してみて。', false],
  ]
  await insert(
    'slack_messages',
    satoMsgs.map(([role, text, img], i) => ({
      slack_team_id: TEAM_ID,
      slack_channel_id: CH2,
      thread_ts: satoThread,
      message_ts: `${satoThread.split('.')[0]}.${String(120300 + i * 40).padStart(6, '0')}`,
      person_id: P2.id,
      slack_user_id: role === 'user' ? 'U08STUDENT2' : null,
      role,
      text,
      has_attachments: img,
      created_at: isoMinutesAgo(215 - i * 3),
    })),
  )

  await insert('slack_messages', [
    {
      slack_team_id: TEAM_ID,
      slack_channel_id: CH1,
      thread_ts: timeoutThread,
      message_ts: timeoutThread,
      person_id: P1.id,
      slack_user_id: 'U08STUDENT1',
      role: 'user',
      text: '相似の証明で、対応する角が等しいことをどう書けばいいのか教えてください。（この質問はタイムアウトで回答が返らなかった例）',
      has_attachments: false,
      created_at: isoMinutesAgo(96),
    },
  ])

  // 一覧の「モデル」「画像あり」フィルタが効くようスレッド単位の実績も入れる
  await insert('ai_usage_logs', [
    {
      person_id: P2.id,
      slack_channel_id: CH2,
      thread_ts: satoThread,
      message_ts: `${satoThread.split('.')[0]}.120340`,
      model: MODEL_COMPLEX,
      input_tokens: 9120,
      output_tokens: 980,
      total_tokens: 10100,
      estimated_cost: usageCost(MODEL_COMPLEX, 9120, 980),
      has_image: true,
      latency_ms: 6100,
      created_at: isoMinutesAgo(214),
    },
    {
      person_id: P2.id,
      slack_channel_id: CH2,
      thread_ts: satoThread,
      message_ts: `${satoThread.split('.')[0]}.120420`,
      model: MODEL_DEFAULT,
      input_tokens: 6400,
      output_tokens: 610,
      total_tokens: 7010,
      estimated_cost: usageCost(MODEL_DEFAULT, 6400, 610),
      has_image: false,
      latency_ms: 4200,
      created_at: isoMinutesAgo(205),
    },
  ])
}

// --- 認証（撮影用の一時管理者）------------------------------------------------

async function upsertShootAdmin() {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
  const body = {
    email: SHOOT_USER.email,
    password: SHOOT_USER.password,
    email_confirm: true,
    app_metadata: { role: 'admin' },
  }
  let res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (res.ok) return (await res.json()).id

  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, { headers })
  const { users } = await list.json()
  const existing = users.find((u) => u.email?.toLowerCase() === SHOOT_USER.email.toLowerCase())
  if (!existing) throw new Error(`撮影用ユーザーの作成に失敗: ${await res.text()}`)
  res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existing.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`撮影用ユーザーの更新に失敗: ${await res.text()}`)
  return existing.id
}

async function deleteShootAdmin(userId) {
  if (!userId) return
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  })
}

// --- 撮影 ---------------------------------------------------------------------

const WIDTH = 1200
/** 横に広い表（ジョブ・会話ログ）用。main の max-w-6xl（1152px）を使い切れる幅 */
const WIDE = 1460
const MAX_HEIGHT = 1900
const MIN_HEIGHT = 520
const shots = []

/**
 * 管理画面は main が内側スクロールなので、中身の高さに合わせてビューポートを伸ばす。
 * main 自身は flex-1 で「ビューポートいっぱい」に育つため scrollHeight を測っても縮まない。
 * 実際の中身は main の子（mx-auto max-w-6xl のラッパ）なので、そちらの高さ + main の余白で測る。
 */
async function fitViewport(page, width = WIDTH) {
  await page.setViewportSize({ width, height: MAX_HEIGHT })
  await page.waitForTimeout(180)
  const needed = await page.evaluate(() => {
    const main = document.getElementById('admin-main')
    const inner = main?.firstElementChild
    if (!main || !inner) return document.documentElement.scrollHeight
    const innerTop = inner.getBoundingClientRect().top
    // main の下パディング（p-6 = 24px）を足して切れないようにする
    const padBottom = parseFloat(getComputedStyle(main).paddingBottom) || 0
    return Math.ceil(innerTop + inner.scrollHeight + padBottom)
  })
  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, needed + 2))
  await page.setViewportSize({ width, height })
  await page.waitForTimeout(180)
  return height
}

async function save(target, name, options = {}) {
  const path = join(OUT_DIR, name)
  await target.screenshot({ path, ...options })
  const size = statSync(path).size
  shots.push({ name, size })
  console.log(`[shot] ${name}  ${(size / 1024).toFixed(0)} KB`)
}

async function shootFullPage(page, name, width = WIDTH) {
  await fitViewport(page, width)
  await save(page, name)
}

/**
 * 要素だけを撮る（確認ダイアログ・カード・表など）。
 * 先に fitViewport でビューポートを中身の高さまで伸ばす。管理画面は main が内側スクロールで、
 * ビューポートより下にある部分は要素スクリーンショットでも白く抜けるため。
 */
async function shootElement(page, locator, name) {
  await fitViewport(page)
  await locator.waitFor()
  await save(locator, name)
}

/** ページ先頭から、指定要素の下端までを撮る（「画面上部」系のカット用） */
async function shootTopThrough(page, selectorLocator, name, pad = 16, width = WIDTH) {
  await fitViewport(page, width)
  const box = await selectorLocator.boundingBox()
  if (!box) throw new Error(`${name}: 対象要素が見つかりません`)
  const height = Math.ceil(box.y + box.height + pad)
  await save(page, name, { clip: { x: 0, y: 0, width, height } })
}

async function goAdmin(page, path, headingText) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  if (headingText) {
    await page.getByRole('heading', { name: headingText, level: 1 }).first().waitFor({ timeout: 20_000 })
  }
  await page.waitForTimeout(400)
}

async function takeAllShots(page, ids) {
  // --- 第1章 / 第2章: ダッシュボード ---
  await goAdmin(page, '/admin', 'ダッシュボード')
  await shootFullPage(page, '01-dashboard.png')
  await shootTopThrough(page, page.locator('main .grid').first(), '02-dashboard-top.png')
  await shootElement(
    page,
    page.locator('main div.rounded-xl').filter({ hasText: 'AI応答' }).first(),
    '07-killswitch-card.png',
  )

  // 緊急停止の確認ダイアログ（開くだけ。停止は実行しない）
  await page.getByRole('button', { name: 'AI応答を停止' }).click()
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(300)
  await save(page.getByRole('dialog'), '07-killswitch-dialog.png')
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click()
  await page.waitForTimeout(200)

  // --- 第2章: エラー管理 ---
  await goAdmin(page, '/admin/errors', 'エラー管理')
  await shootFullPage(page, '02-errors-list.png')

  await goAdmin(page, `/admin/errors/${ids.errorId}`, 'AI_TIMEOUT')
  await shootFullPage(page, '02-error-detail.png')

  // --- 第2章: 会話ログ ---
  // 表が広く、1200px では「件数・状態」列が折り返す。max-w-6xl（1152px）を
  // 使い切れる幅にして 1 行に収める
  await goAdmin(page, '/admin/conversations', '会話ログ')
  await shootFullPage(page, '02-conversations-list.png', WIDE)

  await goAdmin(page, `/admin/conversations/${ids.threadId}`, P1.name)
  await shootFullPage(page, '02-conversation-detail.png')

  // --- 第2章: ジョブ ---
  // 1200px では右端の「操作」列（再実行ボタン）が隠れるので広い幅で撮る
  await goAdmin(page, '/admin/jobs', 'ジョブ管理')
  await shootFullPage(page, '02-jobs.png', WIDE)

  // --- 第3章: 生徒 ---
  await goAdmin(page, '/admin/persons/new', '新規生徒')
  await page.getByLabel('名前').fill('山田 太郎')
  await page.getByLabel('表示名（任意）').fill('たろう')
  await page.getByLabel('学年（任意）').fill('中学2年')
  await page.getByLabel('保護者メール（任意）').fill('taro.guardian@example.com')
  await page.waitForTimeout(200)
  await shootFullPage(page, '03-person-new-form.png')

  await goAdmin(page, `/admin/persons/${P1.id}`, P1.name)
  const profileCard = page.locator('main div.rounded-xl').filter({ hasText: 'AI 用プロフィール' }).first()
  await shootElement(page, profileCard, '03-profile-form.png')
  await shootElement(page, page.locator('main fieldset').first(), '03-exam-period.png')

  // 一覧は「試験期間中バッジが付いた行」を見せるのが目的なので表だけ切り出す
  await goAdmin(page, '/admin/persons', '生徒管理')
  await shootElement(page, page.locator('main table'), '03-persons-list-exam-badge.png')

  // --- 第3章: チャンネル紐付け ---
  await goAdmin(page, '/admin/channels/new', '新規チャンネル紐付け')
  await page.getByLabel('SlackチャンネルID').fill('C08TARO2026')
  await page.getByLabel('ワークスペースID').fill(TEAM_ID)
  await page.getByLabel('チャンネル名（任意）').fill('study-taro')
  await page.getByLabel('生徒').click()
  await page.getByRole('option', { name: P1.name }).click()
  await page.waitForTimeout(300)
  await shootFullPage(page, '03-binding-new-form.png')

  await page.getByRole('button', { name: '紐付ける' }).click()
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(300)
  await save(page.getByRole('dialog'), '03-binding-confirm-dialog.png')
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click()
  await page.waitForTimeout(200)

  await goAdmin(page, '/admin/channels', 'チャンネル紐付け')
  await shootFullPage(page, '03-bindings-list.png')

  // --- 第4章: レポート ---
  await goAdmin(page, '/admin/reports/new', '新規レポート')
  await page.getByLabel('生徒').click()
  await page.getByRole('option', { name: P1.name }).click()
  await page.getByLabel('対象月').fill(`${new Date().getFullYear()}-08`)
  await page.getByLabel('タイトル').fill(`${new Date().getFullYear()}年8月 学習レポート`)
  await page.getByLabel('本文（Markdown）').fill(REPORT_A_BODY)
  // fill でキャレットが末尾に行き textarea が下までスクロールするため先頭に戻す
  await page.locator('#bodyMarkdown').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.waitForTimeout(300)
  await shootFullPage(page, '04-report-new-form.png')

  await goAdmin(page, '/admin/reports', 'レポート管理')
  await shootFullPage(page, '04-reports-list.png')

  await goAdmin(page, `/admin/reports/${REPORT_A}`, `${new Date().getFullYear()}年8月 学習レポート`)
  await shootTopThrough(page, page.locator('main dl').first(), '04-report-detail-status.png')

  await goAdmin(page, `/admin/reports/${REPORT_B}`, `${new Date().getFullYear()}年8月 学習レポート`)
  await shootTopThrough(page, page.locator('main dl').first(), '04-report-embedding-warning.png')

  // --- 第6章: 利用状況 ---
  await goAdmin(page, '/admin/usage', '利用状況')
  // Recharts の初回描画を待つ
  await page.locator('main .recharts-surface').first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1200)
  await shootFullPage(page, '06-usage.png')
}

// --- main ---------------------------------------------------------------------

let snap
let shootUserId

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  console.log('[1/8] モックサーバーと next start を起動')
  startServers()
  await waitForUrl(`${MOCK_BASE}/__mock/health`, 30_000, 'モックサーバー')
  await waitForUrl(BASE, 120_000, 'next start')

  console.log('[2/8] 既存行を退避して空にする')
  snap = await snapshot()
  await deleteAll()

  console.log('[3/8] マニュアル用のサンプルデータを投入')
  await seedBase()
  await seedUsage()
  await seedErrors()
  await seedJobs()

  console.log('[4/8] Slack フロー（モック経由）で会話ログを作る')
  await runSlackFlow()
  await seedExtraThreads()

  const { data: err } = await db
    .from('ai_error_logs')
    .select('id')
    .eq('error_code', 'AI_TIMEOUT')
    .limit(1)
    .single()
  const { data: thread } = await db
    .from('slack_thread_sessions')
    .select('id')
    .eq('slack_channel_id', CH1)
    .limit(1)
    .single()
  if (!err || !thread) throw new Error('サンプルデータの ID を引けませんでした')

  console.log('[5/8] 撮影用の管理者でログイン')
  shootUserId = await upsertShootAdmin()

  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    // date / month 入力の表示書式はブラウザ UI の言語で決まる（ページの lang では変わらない）
    args: ['--lang=ja-JP'],
  })
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: MAX_HEIGHT },
      colorScheme: 'light',
      deviceScaleFactor: 1,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    })
    // テーマ切替は localStorage を見るのでライト固定にする
    await context.addInitScript(() => {
      try {
        localStorage.setItem('theme', 'light')
      } catch {
        /* ignore */
      }
    })
    const page = await context.newPage()
    page.setDefaultTimeout(20_000)

    await page.goto(`${BASE}/login`, { waitUntil: 'load' })
    await page.getByLabel('メールアドレス').fill(SHOOT_USER.email)
    await page.getByLabel('パスワード').fill(SHOOT_USER.password)
    await page.getByRole('button', { name: 'ログイン' }).click()
    await page.waitForURL('**/admin', { timeout: 30_000 })

    console.log('[6/8] 撮影')
    await takeAllShots(page, { errorId: err.id, threadId: thread.id })
    await context.close()
  } finally {
    await browser.close()
  }

  console.log('[7/8] サンプルデータを削除')
  await deleteAll()
  await deleteShootAdmin(shootUserId)
  shootUserId = undefined

  console.log('[8/8] 退避した行を復元して照合')
  await restore(snap)
  const problems = await verifyRestored(snap)
  if (problems.length > 0) {
    console.error('復元の照合に失敗:\n' + problems.join('\n'))
    process.exitCode = 1
  } else {
    console.log('[db] 復元を照合: 退避時と完全一致')
  }

  console.log('\n=== 撮影結果 ===')
  for (const s of shots) console.log(`${s.name}\t${(s.size / 1024).toFixed(0)} KB`)
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith('.png'))
  console.log(`合計 ${files.length} 枚 / ${(files.reduce((n, f) => n + statSync(join(OUT_DIR, f)).size, 0) / 1024 / 1024).toFixed(2)} MB`)
}

main()
  .catch(async (err) => {
    console.error('\n撮影に失敗しました:', err)
    process.exitCode = 1
    // 失敗しても投入したデータは必ず片付ける
    try {
      if (snap) {
        await deleteAll()
        await restore(snap)
        console.error('[db] サンプルデータを削除し、退避した行を復元しました')
      }
      await deleteShootAdmin(shootUserId)
    } catch (cleanupErr) {
      console.error('後片付けにも失敗しました。バックアップ:', BACKUP_PATH, cleanupErr)
    }
  })
  .finally(() => {
    stopServers()
    setTimeout(() => process.exit(process.exitCode ?? 0), 500)
  })
