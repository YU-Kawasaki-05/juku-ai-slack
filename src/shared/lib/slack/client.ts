/** @file
 * 機能: Slack Web API クライアント（chat.postMessage / reactions.add / reactions.remove）
 * 入力: 各メソッドの引数（channel, text, thread_ts, timestamp, name）
 * 出力: Slack API のパース済みレスポンス
 * 例外: postMessage は失敗時 SlackPostFailedError。reactions 系は結果を返すのみ（呼び出し側で握りつぶす）
 * 依存: 環境変数 SLACK_BOT_TOKEN、fetch
 * 副作用: Slack へのメッセージ送信・リアクション付与
 * セキュリティ: Bot Token はサーバー環境変数のみ。クライアントに露出しない
 * @implements FR-05, FR-01, AC-01-06
 */
import { SlackPostFailedError } from '@shared/lib/errors/AppError'

const SLACK_API_BASE = 'https://slack.com/api'

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

async function callSlack(method: string, payload: Record<string, unknown>): Promise<SlackApiResponse> {
  const res = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${getBotToken()}`,
    },
    body: JSON.stringify(payload),
  })
  return (await res.json()) as SlackApiResponse
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

/**
 * リアクションを付与する。失敗しても例外を投げず結果を返す（BR-01-06: サイレント無視）。
 * すでに付いている（already_reacted）等の API エラーも呼び出し側の処理を妨げない。
 */
export async function addReaction(params: ReactionParams): Promise<SlackApiResponse> {
  return callSlack('reactions.add', {
    channel: params.channel,
    timestamp: params.timestamp,
    name: params.name,
  })
}

/** リアクションを削除する。失敗しても例外を投げず結果を返す（AI 回答後の 🤔 除去） */
export async function removeReaction(params: ReactionParams): Promise<SlackApiResponse> {
  return callSlack('reactions.remove', {
    channel: params.channel,
    timestamp: params.timestamp,
    name: params.name,
  })
}
