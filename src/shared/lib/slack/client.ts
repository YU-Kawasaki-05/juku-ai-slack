/** @file
 * 機能: Slack Web API クライアント（chat.postMessage / reactions.add / reactions.remove）
 * 入力: 各メソッドの引数（channel, text, thread_ts, timestamp, name）
 * 出力: Slack API のパース済みレスポンス
 * 例外: postMessage は失敗時 SlackPostFailedError。reactions 系は結果を返すのみ（呼び出し側で握りつぶす）
 *   HTTP 層の失敗（タイムアウト・5xx・非 JSON 応答）も { ok:false, error } に正規化する
 * 依存: 環境変数 SLACK_BOT_TOKEN、fetch（10 秒タイムアウト）
 * 副作用: Slack へのメッセージ送信・リアクション付与
 * セキュリティ: Bot Token はサーバー環境変数のみ。クライアントに露出しない
 * @implements FR-05, FR-01, AC-01-06
 */
import { SlackPostFailedError } from '@shared/lib/errors/AppError'

const SLACK_API_BASE = 'https://slack.com/api'

/** Web API 1 回あたりのタイムアウト（ミリ秒）。無限ハングで実行時間を食い潰さない */
const SLACK_API_TIMEOUT_MS = 10_000

interface SlackApiResponse {
  ok: boolean
  error?: string
  ts?: string
  [key: string]: unknown
}

function getBotToken(): string {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) {
    throw new SlackPostFailedError('SLACK_BOT_TOKEN is not set')
  }
  return token
}

/**
 * Slack Web API を呼ぶ。HTTP 層の失敗（タイムアウト・5xx・HTML 応答・JSON 破損）も
 * `{ ok: false, error }` に正規化して返す。呼び出し側は Slack API のエラーと同じ扱いでよい
 * （postMessage → SlackPostFailedError、reactions → サイレント無視）。
 */
async function callSlack(method: string, payload: Record<string, unknown>): Promise<SlackApiResponse> {
  let res: Response
  try {
    res = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${getBotToken()}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SLACK_API_TIMEOUT_MS),
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    const timedOut = name === 'TimeoutError' || name === 'AbortError'
    return { ok: false, error: timedOut ? `http_timeout(${SLACK_API_TIMEOUT_MS}ms)` : 'http_request_failed' }
  }

  if (res.status === 429) {
    // 実リトライはジョブ側の責務。ここでは調査できるよう Retry-After を残す
    console.warn(`[slack] ${method} rate limited (429). retry-after=${res.headers.get('retry-after') ?? 'unknown'}`)
    return { ok: false, error: 'ratelimited' }
  }
  if (!res.ok) {
    return { ok: false, error: `http_${res.status}` }
  }
  // 障害時の Slack は 200 でも HTML を返すことがある。JSON でなければパースを試みない
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return { ok: false, error: `unexpected_content_type(${contentType || 'none'})` }
  }
  try {
    return (await res.json()) as SlackApiResponse
  } catch {
    return { ok: false, error: 'invalid_json_response' }
  }
}

export interface PostMessageParams {
  channel: string
  text: string
  /** スレッド返信にする場合の親 ts */
  threadTs?: string
}

/** スレッドにメッセージを投稿する。失敗時は SlackPostFailedError を投げる */
export async function postMessage(params: PostMessageParams): Promise<{ ts: string }> {
  const body: Record<string, unknown> = { channel: params.channel, text: params.text }
  if (params.threadTs) body.thread_ts = params.threadTs

  const result = await callSlack('chat.postMessage', body)
  if (!result.ok) {
    throw new SlackPostFailedError(`chat.postMessage failed: ${result.error ?? 'unknown'}`)
  }
  return { ts: result.ts ?? '' }
}

export interface ReactionParams {
  channel: string
  /** リアクション対象メッセージの ts */
  timestamp: string
  /** リアクション名（コロンなし。例: thinking_face） */
  name: string
}

/** 想定内でノイズにしかならないリアクションエラー（状態がすでに目的どおり） */
const IGNORABLE_REACTION_ERRORS = new Set(['already_reacted', 'no_reaction'])

/**
 * リアクションの失敗はサイレント無視だが、missing_scope / invalid_auth のような
 * 構成ミスまで不可視になると原因追跡ができないためログには残す。
 */
function warnReactionFailure(method: string, result: SlackApiResponse): SlackApiResponse {
  const error = result.error ?? 'unknown'
  if (!result.ok && !IGNORABLE_REACTION_ERRORS.has(error)) {
    console.warn(`[slack] ${method} failed: ${error}`)
  }
  return result
}

/**
 * リアクションを付与する。失敗しても例外を投げず結果を返す（BR-01-06: サイレント無視）。
 * すでに付いている（already_reacted）等の API エラーも呼び出し側の処理を妨げない。
 */
export async function addReaction(params: ReactionParams): Promise<SlackApiResponse> {
  const result = await callSlack('reactions.add', {
    channel: params.channel,
    timestamp: params.timestamp,
    name: params.name,
  })
  return warnReactionFailure('reactions.add', result)
}

/** リアクションを削除する。失敗しても例外を投げず結果を返す（AI 回答後の 🤔 除去） */
export async function removeReaction(params: ReactionParams): Promise<SlackApiResponse> {
  const result = await callSlack('reactions.remove', {
    channel: params.channel,
    timestamp: params.timestamp,
    name: params.name,
  })
  return warnReactionFailure('reactions.remove', result)
}
