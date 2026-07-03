/** @file
 * 機能: Slack リクエスト署名検証（HMAC-SHA256）+ タイムスタンプ鮮度チェック
 * 入力: x-slack-signature / x-slack-request-timestamp ヘッダー、raw body、signing secret
 * 出力: { valid, reason? }
 * 例外: なし（判定のみ返す。呼び出し側が 401 を返す）
 * 依存: node:crypto
 * セキュリティ: timingSafeEqual で定数時間比較。raw body 必須（パース後の再文字列化では不可）
 * @implements FR-01, AC-01-02, AC-01-03, AC-01-05
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { SLACK_SIGNATURE_VERSION, SLACK_TIMESTAMP_TOLERANCE_SEC } from '@shared/lib/constants'

export type SignatureFailureReason =
  | 'missing_headers'
  | 'timestamp_expired'
  | 'signature_mismatch'

export interface VerifySignatureParams {
  signature: string | null | undefined
  timestamp: string | null | undefined
  rawBody: string
  signingSecret: string
  /** 検証基準の現在時刻（Unix 秒）。省略時は now。テスト用に注入可能 */
  nowSec?: number
  toleranceSec?: number
}

export interface VerifySignatureResult {
  valid: boolean
  reason?: SignatureFailureReason
}

/**
 * Slack 署名を検証する。
 * basestring = `v0:{timestamp}:{rawBody}` を signing secret で HMAC-SHA256 し、
 * `v0={hex}` が x-slack-signature と定数時間比較で一致するか判定する。
 */
export function verifySlackSignature(params: VerifySignatureParams): VerifySignatureResult {
  const { signature, timestamp, rawBody, signingSecret } = params
  const toleranceSec = params.toleranceSec ?? SLACK_TIMESTAMP_TOLERANCE_SEC
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000)

  if (!signature || !timestamp) {
    return { valid: false, reason: 'missing_headers' }
  }

  const tsNum = Number(timestamp)
  if (!Number.isFinite(tsNum)) {
    return { valid: false, reason: 'missing_headers' }
  }

  // BR-01-02: 現在時刻から toleranceSec 秒以上ずれていたら拒否（過去・未来とも）
  if (Math.abs(nowSec - tsNum) > toleranceSec) {
    return { valid: false, reason: 'timestamp_expired' }
  }

  const basestring = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac('sha256', signingSecret)
    .update(basestring)
    .digest('hex')}`

  // 長さが違うと timingSafeEqual が例外を投げるため先にガード
  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length) {
    return { valid: false, reason: 'signature_mismatch' }
  }
  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: 'signature_mismatch' }
  }

  return { valid: true }
}
