import { test, expect } from '@playwright/test'
import { createHmac } from 'node:crypto'

/**
 * Slack Events Webhook（FR-01）。署名検証が実際の HTTP 経路で効いていることを確認する。
 * 生成 AI を呼ぶ event_callback はスコープ外（受入テストで実施）。
 */
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? ''

function sign(rawBody: string, timestamp: string): string {
  return `v0=${createHmac('sha256', SIGNING_SECRET).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`
}

function nowSec(): string {
  return String(Math.floor(Date.now() / 1000))
}

async function post(
  request: import('@playwright/test').APIRequestContext,
  rawBody: string,
  headers: Record<string, string>,
) {
  return request.post('/api/slack/events', {
    data: rawBody,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

test('署名ヘッダーが無いと 401', async ({ request }) => {
  const res = await post(request, JSON.stringify({ type: 'url_verification', challenge: 'x' }), {})
  expect(res.status()).toBe(401)
})

test('署名が不正だと 401', async ({ request }) => {
  const ts = nowSec()
  const body = JSON.stringify({ type: 'url_verification', challenge: 'x' })
  const res = await post(request, body, {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': 'v0=deadbeef',
  })
  expect(res.status()).toBe(401)
})

test('タイムスタンプが古すぎると 401（リプレイ防止）', async ({ request }) => {
  const ts = String(Math.floor(Date.now() / 1000) - 600)
  const body = JSON.stringify({ type: 'url_verification', challenge: 'x' })
  const res = await post(request, body, {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': sign(body, ts),
  })
  expect(res.status()).toBe(401)
})

test('正しい署名の url_verification は challenge をそのまま返す', async ({ request }) => {
  const ts = nowSec()
  const challenge = `e2e-challenge-${Date.now()}`
  const body = JSON.stringify({ type: 'url_verification', challenge })
  const res = await post(request, body, {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': sign(body, ts),
  })
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ challenge })
})
