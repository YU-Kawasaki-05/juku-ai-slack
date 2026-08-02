#!/usr/bin/env node
/** @file
 * 機能: 受け入れテスト用のモック外部サービス（Slack Web API + OpenAI 互換 LLM）を 1 プロセスで提供する
 * 入力: HTTP（Playwright の webServer として起動。ポートは MOCK_PORT、既定 3251）
 * 出力: Slack/LLM の応答 + 記録した呼び出しの参照 API
 * 依存: node:http のみ（テスト専用。アプリからは参照しない）
 * 備考: **実 Slack API・実 LLM API は絶対に呼ばない**ことを保証するための代替サーバー。
 *   アプリ側は SLACK_API_BASE_URL / LLM_BASE_URL をここへ向ける。
 *
 * エンドポイント:
 *   POST /slack/chat.postMessage | /slack/reactions.add | /slack/reactions.remove
 *   POST /llm/chat/completions            OpenAI 互換 Chat Completions
 *   GET  /__mock/health                   起動確認
 *   GET  /__mock/calls?kind=&method=&channel=&contains=   記録した呼び出し（新しい順）
 *   POST /__mock/reset                    記録を全消去（並列実行では使わない）
 *
 * LLM の応答は「プロンプトに埋め込まれたマーカー」で決まる（サーバー状態を持たないので並列実行に強い）:
 *   [[MOCK:TRUNCATE]] → finish_reason=length（打ち切り通知の検証）
 *   [[MOCK:INJECT]]   → 本文に <!channel> を含める（C-3 エスケープの検証）
 *   [[MOCK:FAIL]]     → HTTP 500（AI_RESPONSE_FAILED 経路の検証）
 *   [[MOCK:RATELIMIT]]→ HTTP 429（AI_RATE_LIMITED 経路の検証）
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 3251)

/** @type {Array<{id:number, at:string, kind:string, method:string, body:any, raw:string}>} */
const calls = []
let seq = 0

/**
 * postMessage が返す ts。実 Slack と同じ「秒.マイクロ秒」形式かつ**時刻順に単調増加**させる。
 * 会話ログは message_ts で並べる（getConversations）ため、ここを乱数にすると
 * 質問と回答の表示順が入れ替わり、モック由来の偽の不具合に見えてしまう。
 */
function nextTs() {
  const now = Date.now()
  seq += 1
  return `${Math.floor(now / 1000)}.${String((now % 1000) * 1000 + (seq % 1000)).padStart(6, '0')}`
}

function record(kind, method, body, raw) {
  const entry = { id: ++seq, at: new Date().toISOString(), kind, method, body, raw }
  calls.push(entry)
  // 長時間実行でも青天井にしない
  if (calls.length > 2000) calls.splice(0, calls.length - 2000)
  return entry
}

function json(res, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    // client.ts は content-type が application/json でないとパースを拒否する
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** LLM 応答本文を組み立てる。マーカーはプロンプト全文（raw）から探す */
function buildLlmAnswer(raw) {
  if (raw.includes('[[MOCK:INJECT]]')) {
    return 'これがモック回答だよ。<!channel> みんな集合！ &amp; 記号も入れておくね。'
  }
  if (raw.includes('[[MOCK:TRUNCATE]]')) {
    return 'これはモックの途中まで回答で、ここで切れ'
  }
  return 'モックLLMの回答です。まずは式を整理してみよう。答えは x = 3 だよ。'
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const path = url.pathname

  // --- 参照 API ---------------------------------------------------------
  if (req.method === 'GET' && path === '/__mock/health') {
    return json(res, 200, { ok: true, port: PORT })
  }

  if (req.method === 'GET' && path === '/__mock/calls') {
    const kind = url.searchParams.get('kind')
    const method = url.searchParams.get('method')
    const channel = url.searchParams.get('channel')
    const contains = url.searchParams.get('contains')
    const found = calls.filter((c) => {
      if (kind && c.kind !== kind) return false
      if (method && c.method !== method) return false
      if (channel && c.body?.channel !== channel) return false
      if (contains && !c.raw.includes(contains)) return false
      return true
    })
    return json(res, 200, { count: found.length, calls: found })
  }

  if (req.method === 'POST' && path === '/__mock/reset') {
    calls.length = 0
    return json(res, 200, { ok: true })
  }

  // --- Slack Web API ----------------------------------------------------
  if (req.method === 'POST' && path.startsWith('/slack/')) {
    const method = path.slice('/slack/'.length)
    const raw = await readBody(req)
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      body = {}
    }
    record('slack', method, body, raw)

    if (method === 'chat.postMessage') {
      return json(res, 200, { ok: true, channel: body.channel, ts: nextTs() })
    }
    if (method === 'reactions.add' || method === 'reactions.remove') {
      return json(res, 200, { ok: true })
    }
    return json(res, 200, { ok: false, error: 'unknown_method' })
  }

  // --- OpenAI 互換 LLM --------------------------------------------------
  if (req.method === 'POST' && path === '/llm/chat/completions') {
    const raw = await readBody(req)
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      body = {}
    }
    record('llm', 'chat.completions', body, raw)

    if (raw.includes('[[MOCK:RATELIMIT]]')) {
      return json(res, 429, { error: { message: 'rate limited (mock)', type: 'rate_limit_error' } })
    }
    if (raw.includes('[[MOCK:FAIL]]')) {
      return json(res, 500, { error: { message: 'boom (mock)', type: 'server_error' } })
    }

    const content = buildLlmAnswer(raw)
    const truncated = raw.includes('[[MOCK:TRUNCATE]]')
    return json(res, 200, {
      id: `chatcmpl-mock-${seq}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model ?? 'mock-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: truncated ? 'length' : 'stop',
        },
      ],
      usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
    })
  }

  return json(res, 404, { ok: false, error: 'not_found', path })
})

server.listen(PORT, '127.0.0.1', () => {
  // テスト専用プロセスの起動バナー。どのポートで待ち受けたかは E2E 失敗時の切り分けに要る
  // eslint-disable-next-line no-console
  console.log(`[mock] slack+llm mock listening on http://127.0.0.1:${PORT}`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
