/** @file
 * 検証: Slack 署名検証（HMAC-SHA256）とタイムスタンプ鮮度
 * @verifies AC-01-02, AC-01-03, AC-01-05
 */
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifySlackSignature } from './verifySignature'

const SECRET = 'test-signing-secret'

function sign(rawBody: string, timestamp: string, secret = SECRET): string {
  const base = `v0:${timestamp}:${rawBody}`
  return `v0=${createHmac('sha256', secret).update(base).digest('hex')}`
}

describe('verifySlackSignature', () => {
  const rawBody = JSON.stringify({ type: 'event_callback', event_id: 'Ev1' })
  const now = 1_700_000_000

  it('有効な署名なら valid=true（AC-01-02）', () => {
    const ts = String(now)
    const result = verifySlackSignature({
      signature: sign(rawBody, ts),
      timestamp: ts,
      rawBody,
      signingSecret: SECRET,
      nowSec: now,
    })
    expect(result.valid).toBe(true)
  })

  it('署名が改ざんされていたら valid=false（AC-01-03）', () => {
    const ts = String(now)
    const result = verifySlackSignature({
      signature: sign(rawBody, ts) + 'ff',
      timestamp: ts,
      rawBody,
      signingSecret: SECRET,
      nowSec: now,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('signature_mismatch')
  })

  it('body が改ざんされたら署名不一致になる（AC-01-03）', () => {
    const ts = String(now)
    const sig = sign(rawBody, ts)
    const result = verifySlackSignature({
      signature: sig,
      timestamp: ts,
      rawBody: rawBody + 'tampered',
      signingSecret: SECRET,
      nowSec: now,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('signature_mismatch')
  })

  it('署名秘密鍵が違えば不一致（AC-01-03）', () => {
    const ts = String(now)
    const result = verifySlackSignature({
      signature: sign(rawBody, ts, 'wrong-secret'),
      timestamp: ts,
      rawBody,
      signingSecret: SECRET,
      nowSec: now,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('signature_mismatch')
  })

  it('タイムスタンプが301秒古いと timestamp_expired（AC-01-05）', () => {
    const ts = String(now - 301)
    const result = verifySlackSignature({
      signature: sign(rawBody, ts),
      timestamp: ts,
      rawBody,
      signingSecret: SECRET,
      nowSec: now,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('timestamp_expired')
  })

  it('タイムスタンプが未来に301秒ずれても timestamp_expired', () => {
    const ts = String(now + 301)
    const result = verifySlackSignature({
      signature: sign(rawBody, ts),
      timestamp: ts,
      rawBody,
      signingSecret: SECRET,
      nowSec: now,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('timestamp_expired')
  })

  it('300秒ちょうどのずれは許容する', () => {
    const ts = String(now - 300)
    const result = verifySlackSignature({
      signature: sign(rawBody, ts),
      timestamp: ts,
      rawBody,
      signingSecret: SECRET,
      nowSec: now,
    })
    expect(result.valid).toBe(true)
  })

  it('ヘッダー欠落なら missing_headers', () => {
    expect(
      verifySlackSignature({ signature: null, timestamp: '1', rawBody, signingSecret: SECRET })
        .reason,
    ).toBe('missing_headers')
    expect(
      verifySlackSignature({ signature: 'v0=x', timestamp: null, rawBody, signingSecret: SECRET })
        .reason,
    ).toBe('missing_headers')
  })

  it('タイムスタンプが数値でなければ missing_headers', () => {
    const result = verifySlackSignature({
      signature: 'v0=abc',
      timestamp: 'not-a-number',
      rawBody,
      signingSecret: SECRET,
      nowSec: now,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('missing_headers')
  })
})
