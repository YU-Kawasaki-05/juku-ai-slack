import { describe, it, expect } from 'vitest'
import {
  getUserFacingMessage,
  isSilentError,
  USER_FACING_MESSAGES,
  SILENT_ERROR_CODES,
} from '../userMessages'

describe('getUserFacingMessage', () => {
  it('returns the message for a known code', () => {
    expect(getUserFacingMessage('AI_RATE_LIMITED')).toBe(USER_FACING_MESSAGES['AI_RATE_LIMITED'])
  })

  it('falls back to UNKNOWN_ERROR for an unrecognized code', () => {
    expect(getUserFacingMessage('NONEXISTENT_CODE')).toBe(USER_FACING_MESSAGES['UNKNOWN_ERROR'])
  })
})

describe('isSilentError', () => {
  it('returns true for codes in SILENT_ERROR_CODES', () => {
    SILENT_ERROR_CODES.forEach((code) => {
      expect(isSilentError(code)).toBe(true)
    })
  })

  it('returns false for user-facing codes', () => {
    expect(isSilentError('AI_RATE_LIMITED')).toBe(false)
    expect(isSilentError('CHANNEL_NOT_BOUND')).toBe(false)
  })

  it('PERSON_INACTIVE はサイレント（退塾生チャンネルに投稿しない, H-6）', () => {
    expect(isSilentError('PERSON_INACTIVE')).toBe(true)
  })
})

describe('停止・レート制限の文言（F-1 / F-2）', () => {
  it('AI_PAUSED はメンテナンス中であることと再試行を伝える', () => {
    const msg = getUserFacingMessage('AI_PAUSED')
    expect(msg).not.toBe(USER_FACING_MESSAGES['UNKNOWN_ERROR'])
    expect(msg).toContain('メンテナンス')
    // 内部事情（kill switch・障害名）は生徒に出さない
    expect(msg).not.toMatch(/kill|switch|error/i)
  })

  it('RATE_LIMITED は責める文言ではなく待ち時間を伝える', () => {
    const msg = getUserFacingMessage('RATE_LIMITED')
    expect(msg).not.toBe(USER_FACING_MESSAGES['UNKNOWN_ERROR'])
    expect(msg).toContain('1時間')
  })

  it('どちらも生徒に返す文言なのでサイレントではない', () => {
    expect(isSilentError('AI_PAUSED')).toBe(false)
    expect(isSilentError('RATE_LIMITED')).toBe(false)
  })
})
