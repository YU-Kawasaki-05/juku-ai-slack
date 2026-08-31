/** @file
 * 検証: ログイン失敗メッセージの出し分け（認証拒否 vs 一時障害）
 * @verifies FR-13, E-8
 */
import { describe, it, expect } from 'vitest'
import {
  toLoginErrorMessage,
  CREDENTIAL_ERROR_MESSAGE,
  TRANSIENT_ERROR_MESSAGE,
} from './LoginForm'

describe('toLoginErrorMessage', () => {
  it.each(['invalid_credentials', 'invalid_grant', 'user_not_found', 'validation_failed'])(
    'code=%s は認証情報エラーとして案内する',
    (code) => {
      expect(toLoginErrorMessage({ code, status: 400 })).toBe(CREDENTIAL_ERROR_MESSAGE)
    },
  )

  it('ネットワーク障害（AuthRetryableFetchError 相当・status 0）は一時障害として案内する', () => {
    expect(toLoginErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toBe(
      TRANSIENT_ERROR_MESSAGE,
    )
  })

  it('Supabase 側の 5xx は一時障害として案内する', () => {
    expect(toLoginErrorMessage({ name: 'AuthApiError', status: 503 })).toBe(TRANSIENT_ERROR_MESSAGE)
  })

  it('レート制限（over_request_rate_limit）は一時障害として案内する', () => {
    expect(toLoginErrorMessage({ code: 'over_request_rate_limit', status: 429 })).toBe(
      TRANSIENT_ERROR_MESSAGE,
    )
  })

  it('メール未確認は入力ミスではないので一時障害側の案内にする', () => {
    expect(toLoginErrorMessage({ code: 'email_not_confirmed', status: 400 })).toBe(
      TRANSIENT_ERROR_MESSAGE,
    )
  })

  it('code を持たない旧形式は 400/401/403 のみ認証情報エラー扱い', () => {
    expect(toLoginErrorMessage({ status: 400 })).toBe(CREDENTIAL_ERROR_MESSAGE)
    expect(toLoginErrorMessage({ status: 401 })).toBe(CREDENTIAL_ERROR_MESSAGE)
    expect(toLoginErrorMessage({ status: 403 })).toBe(CREDENTIAL_ERROR_MESSAGE)
  })

  it('status も code も無い場合は一時障害（断定しない）', () => {
    expect(toLoginErrorMessage({})).toBe(TRANSIENT_ERROR_MESSAGE)
  })
})
