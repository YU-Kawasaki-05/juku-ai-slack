import { describe, it, expect } from 'vitest'
import {
  buildImageNotice,
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

describe('buildImageNotice（#5: 読めなかった画像の案内）', () => {
  it('読めなかった画像が無ければ何も添えない', () => {
    expect(buildImageNotice({ unreadCount: 0, readCount: 2, visionModelMissing: false })).toBe('')
  })

  it('一部が読めなかったら枚数と「読めた画像も使った」ことを伝える', () => {
    const msg = buildImageNotice({ unreadCount: 2, readCount: 1, visionModelMissing: false })
    expect(msg).toContain('2 枚は読み込めなかった')
    expect(msg).toContain('読めた画像と文章の内容で答えたよ')
    // 回答本文の末尾に足す前提で改行から始める
    expect(msg.startsWith('\n\n')).toBe(true)
  })

  it('全部読めなかったら「文章の内容から答えた」と伝える', () => {
    const msg = buildImageNotice({ unreadCount: 3, readCount: 0, visionModelMissing: false })
    expect(msg).toContain('3 枚は読み込めなかった')
    expect(msg).toContain('文章の内容から答えたよ')
  })

  it('Vision 未設定なら理由の羅列はせず1行で伝え、内部事情は出さない', () => {
    const msg = buildImageNotice({ unreadCount: 2, readCount: 1, visionModelMissing: true })
    expect(msg).toContain('画像を読み取れない')
    // 枚数の内訳は生徒の行動を変えないので出さない（1行に丸める）
    expect(msg).not.toContain('枚は読み込めなかった')
    // 環境変数名やモデル名は生徒に見せない
    expect(msg).not.toMatch(/LLM_MODEL|env|model/i)
  })
})
