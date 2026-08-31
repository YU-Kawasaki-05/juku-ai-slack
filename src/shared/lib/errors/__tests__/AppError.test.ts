import { describe, it, expect } from 'vitest'
import {
  AppError,
  ChannelNotBoundError,
  PersonNotFoundError,
  SlackEventDuplicateError,
  LowConfidenceSkipError,
  AiRateLimitedError,
  AiTimeoutError,
  AiResponseFailedError,
  ConfigurationError,
  SlackPostFailedError,
  TokenBudgetExceededError,
  ImageTooLargeError,
  UnsupportedFileTypeError,
  SlackFileDownloadFailedError,
  ImageProcessingFailedError,
} from '../AppError'

describe('AppError', () => {
  it('is an Error instance', () => {
    const err = new AppError('TEST_CODE', 'error', 'test message')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('TEST_CODE')
    expect(err.severity).toBe('error')
    expect(err.message).toBe('test message')
  })

  it('既定は retryable=true（A-11）', () => {
    expect(new AppError('TEST_CODE', 'error', 'm').retryable).toBe(true)
  })

  it('明示すれば retryable=false にできる', () => {
    expect(new AppError('TEST_CODE', 'error', 'm', undefined, false).retryable).toBe(false)
  })
})

describe('retryable の分類（A-11）', () => {
  it.each([
    ['AI_RATE_LIMITED', new AiRateLimitedError()],
    ['AI_TIMEOUT', new AiTimeoutError()],
    ['AI_RESPONSE_FAILED', new AiResponseFailedError()],
    ['SLACK_FILE_DOWNLOAD_FAILED', new SlackFileDownloadFailedError()],
    ['IMAGE_PROCESSING_FAILED', new ImageProcessingFailedError()],
  ])('%s は一過性なのでリトライする', (_code, err) => {
    expect(err.retryable).toBe(true)
  })

  it.each([
    // 投稿の再試行は二重返信になる
    ['SLACK_POST_FAILED', new SlackPostFailedError()],
    // 入力が長すぎる／設定不備／対応外ファイルは再試行で結果が変わらない
    ['TOKEN_BUDGET_EXCEEDED', new TokenBudgetExceededError()],
    ['設定不備', new ConfigurationError('LLM_MODEL_DEFAULT が未設定です')],
    ['IMAGE_TOO_LARGE', new ImageTooLargeError(30_000_000)],
    ['UNSUPPORTED_FILE_TYPE', new UnsupportedFileTypeError('application/pdf')],
    ['CHANNEL_NOT_BOUND', new ChannelNotBoundError()],
    ['PERSON_NOT_FOUND', new PersonNotFoundError('C1')],
  ])('%s はリトライしない', (_code, err) => {
    expect(err.retryable).toBe(false)
  })
})

describe('ConfigurationError', () => {
  it('生徒向けには AI_RESPONSE_FAILED として扱う（内部事情を出さない）', () => {
    const err = new ConfigurationError('LLM_MODEL_DEFAULT が未設定です')
    expect(err.code).toBe('AI_RESPONSE_FAILED')
    expect(err.retryable).toBe(false)
    expect(err.message).toContain('LLM_MODEL_DEFAULT')
  })
})

describe('ChannelNotBoundError', () => {
  it('has correct code and severity', () => {
    const err = new ChannelNotBoundError()
    expect(err.code).toBe('CHANNEL_NOT_BOUND')
    expect(err.severity).toBe('warning')
  })
})

describe('PersonNotFoundError', () => {
  it('includes channelId in message', () => {
    const err = new PersonNotFoundError('C123')
    expect(err.code).toBe('PERSON_NOT_FOUND')
    expect(err.message).toContain('C123')
  })
})

describe('SlackEventDuplicateError', () => {
  it('has info severity', () => {
    const err = new SlackEventDuplicateError('Ev123')
    expect(err.severity).toBe('info')
  })
})

describe('LowConfidenceSkipError', () => {
  it('has info severity for BKT skip', () => {
    const err = new LowConfidenceSkipError()
    expect(err.code).toBe('LOW_CONFIDENCE_SKIP')
    expect(err.severity).toBe('info')
  })
})
