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
})
