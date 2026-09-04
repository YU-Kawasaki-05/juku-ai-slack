/** @file
 * 検証: 招待リンクの解釈・入力検証・エラー文言の出し分け
 * @verifies FR-13
 */
import { describe, it, expect } from 'vitest'
import {
  parseRecoveryLink,
  toRecoveryLinkErrorMessage,
  toUpdatePasswordErrorMessage,
  validateNewPassword,
  MIN_PASSWORD_LENGTH,
  MISMATCH_MESSAGE,
  TOO_SHORT_MESSAGE,
  EXPIRED_LINK_MESSAGE,
  INVALID_LINK_MESSAGE,
  SESSION_LOST_MESSAGE,
  UPDATE_FAILED_MESSAGE,
  WEAK_PASSWORD_MESSAGE,
  SAME_PASSWORD_MESSAGE,
  RATE_LIMITED_MESSAGE,
} from './passwordSetup'

const ORIGIN = 'http://localhost:3000'

describe('parseRecoveryLink', () => {
  it('フラグメントの access_token / refresh_token を取り出す', () => {
    expect(
      parseRecoveryLink(
        `${ORIGIN}/set-password#access_token=AAA&expires_in=3600&refresh_token=BBB&token_type=bearer&type=recovery`,
      ),
    ).toEqual({ kind: 'tokens', accessToken: 'AAA', refreshToken: 'BBB' })
  })

  it('Supabase が返す期限切れフラグメントを error として扱う', () => {
    expect(
      parseRecoveryLink(
        `${ORIGIN}/set-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
      ),
    ).toEqual({ kind: 'error', errorCode: 'otp_expired' })
  })

  it('error がクエリに載っていても取りこぼさない', () => {
    expect(parseRecoveryLink(`${ORIGIN}/set-password?error_code=otp_expired`)).toEqual({
      kind: 'error',
      errorCode: 'otp_expired',
    })
  })

  it('何も載っていない直アクセスは none', () => {
    expect(parseRecoveryLink(`${ORIGIN}/set-password`)).toEqual({ kind: 'none' })
  })

  it('セキュリティ: クエリの access_token は採用しない（クエリはサーバーログや Referer に残る）', () => {
    expect(parseRecoveryLink(`${ORIGIN}/set-password?access_token=AAA&refresh_token=BBB`)).toEqual({
      kind: 'none',
    })
  })

  it('refresh_token を欠くフラグメントはセッションを張れないので none', () => {
    expect(parseRecoveryLink(`${ORIGIN}/set-password#access_token=AAA&type=recovery`)).toEqual({
      kind: 'none',
    })
  })
})

describe('toRecoveryLinkErrorMessage', () => {
  it('otp_expired は有効期限切れとして再発行を案内する', () => {
    expect(toRecoveryLinkErrorMessage('otp_expired')).toBe(EXPIRED_LINK_MESSAGE)
    expect(EXPIRED_LINK_MESSAGE).toContain('有効期限')
    expect(EXPIRED_LINK_MESSAGE).toContain('再発行')
  })

  it('未知のエラーは原因を断定せず「リンクが無効です」にする', () => {
    expect(toRecoveryLinkErrorMessage('server_error')).toBe(INVALID_LINK_MESSAGE)
    expect(toRecoveryLinkErrorMessage(null)).toBe(INVALID_LINK_MESSAGE)
  })
})

describe('validateNewPassword', () => {
  it(`${MIN_PASSWORD_LENGTH} 文字未満は文字数エラー`, () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    expect(validateNewPassword(short, short)).toBe(TOO_SHORT_MESSAGE)
  })

  it('文字数を満たしていても不一致なら不一致エラー', () => {
    expect(validateNewPassword('Passw0rd!x', 'Passw0rd!y')).toBe(MISMATCH_MESSAGE)
  })

  it('文字数を満たし一致していれば null', () => {
    expect(validateNewPassword('Passw0rd!x', 'Passw0rd!x')).toBeNull()
  })

  it('明示する最低文字数は supabase/config.toml の minimum_password_length と一致している', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8)
    expect(TOO_SHORT_MESSAGE).toContain('8 文字以上')
  })
})

describe('toUpdatePasswordErrorMessage', () => {
  it('weak_password は強度不足として案内する', () => {
    expect(toUpdatePasswordErrorMessage({ code: 'weak_password', status: 422 })).toBe(
      WEAK_PASSWORD_MESSAGE,
    )
  })

  it('same_password は別のパスワードを促す', () => {
    expect(toUpdatePasswordErrorMessage({ code: 'same_password', status: 422 })).toBe(
      SAME_PASSWORD_MESSAGE,
    )
  })

  it('レート制限は待って再試行と案内する', () => {
    expect(toUpdatePasswordErrorMessage({ code: 'over_request_rate_limit', status: 429 })).toBe(
      RATE_LIMITED_MESSAGE,
    )
  })

  it('セッション失効系はリンクの再発行を促す（入力を直しても解決しないため）', () => {
    expect(toUpdatePasswordErrorMessage({ code: 'session_not_found', status: 404 })).toBe(
      SESSION_LOST_MESSAGE,
    )
    expect(toUpdatePasswordErrorMessage({ status: 401 })).toBe(SESSION_LOST_MESSAGE)
    expect(toUpdatePasswordErrorMessage({ status: 403 })).toBe(SESSION_LOST_MESSAGE)
  })

  it('分類できないものは一時障害として扱う（断定しない）', () => {
    expect(toUpdatePasswordErrorMessage({ name: 'NetworkError', status: 0 })).toBe(
      UPDATE_FAILED_MESSAGE,
    )
    expect(toUpdatePasswordErrorMessage({})).toBe(UPDATE_FAILED_MESSAGE)
  })
})
