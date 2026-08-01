export type ErrorSeverity = 'error' | 'warning' | 'info'

export class AppError extends Error {
  /**
   * 再試行で解消しうるエラーか（A-11）。
   * false のものはジョブのリトライループを即座に打ち切る
   * （恒久エラーを 3 回叩いてバックオフで待つのは無駄なうえ、LLM 課金や二重投稿の原因になる）。
   */
  public readonly retryable: boolean

  constructor(
    public readonly code: string,
    public readonly severity: ErrorSeverity,
    message: string,
    public readonly cause?: unknown,
    retryable = true,
  ) {
    super(message)
    this.name = 'AppError'
    this.retryable = retryable
  }
}

export class ChannelNotBoundError extends AppError {
  constructor() {
    super('CHANNEL_NOT_BOUND', 'warning', 'Channel has no binding', undefined, false)
  }
}

export class PersonNotFoundError extends AppError {
  constructor(channelId: string) {
    super('PERSON_NOT_FOUND', 'error', `No person found for channel ${channelId}`, undefined, false)
  }
}

export class SlackSignatureInvalidError extends AppError {
  constructor() {
    super('SLACK_SIGNATURE_INVALID', 'error', 'Invalid Slack request signature', undefined, false)
  }
}

export class SlackEventDuplicateError extends AppError {
  constructor(eventId: string) {
    super('SLACK_EVENT_DUPLICATE', 'info', `Duplicate event ${eventId}`, undefined, false)
  }
}

export class SlackFileDownloadFailedError extends AppError {
  constructor(cause?: unknown) {
    super('SLACK_FILE_DOWNLOAD_FAILED', 'error', 'Failed to download Slack file', cause)
  }
}

export class UnsupportedFileTypeError extends AppError {
  constructor(fileType: string) {
    super('UNSUPPORTED_FILE_TYPE', 'warning', `Unsupported file type: ${fileType}`, undefined, false)
  }
}

export class ImageTooLargeError extends AppError {
  constructor(sizeBytes: number) {
    super('IMAGE_TOO_LARGE', 'warning', `Image too large: ${sizeBytes} bytes`, undefined, false)
  }
}

export class ImageProcessingFailedError extends AppError {
  constructor(cause?: unknown) {
    super('IMAGE_PROCESSING_FAILED', 'error', 'Image processing failed', cause)
  }
}

export class AiRateLimitedError extends AppError {
  constructor(cause?: unknown) {
    super('AI_RATE_LIMITED', 'error', 'AI provider rate limited', cause)
  }
}

export class AiTimeoutError extends AppError {
  constructor() {
    super('AI_TIMEOUT', 'error', 'AI response timed out')
  }
}

export class AiResponseFailedError extends AppError {
  constructor(cause?: unknown) {
    super('AI_RESPONSE_FAILED', 'error', 'AI response failed', cause)
  }
}

/** 入力が上限を超えている＝再送しても同じ結果になる（A-11） */
export class TokenBudgetExceededError extends AppError {
  constructor() {
    super('TOKEN_BUDGET_EXCEEDED', 'warning', 'Token budget exceeded', undefined, false)
  }
}

/**
 * Slack への投稿失敗。
 * A-3: 投稿は「1回限りの配信」なのでリトライしない。
 * レスポンスを取り逃しただけで実際は届いているケースがあり、再試行すると二重返信になる。
 */
export class SlackPostFailedError extends AppError {
  constructor(cause?: unknown) {
    super('SLACK_POST_FAILED', 'error', 'Failed to post Slack message', cause, false)
  }
}

export class JobTimeoutError extends AppError {
  constructor(jobId: string) {
    super('JOB_TIMEOUT', 'error', `Job ${jobId} timed out`, undefined, false)
  }
}

export class LowConfidenceSkipError extends AppError {
  constructor() {
    super('LOW_CONFIDENCE_SKIP', 'info', 'BKT update skipped due to low confidence', undefined, false)
  }
}

export class ReportNotFoundError extends AppError {
  constructor() {
    super('REPORT_NOT_FOUND', 'info', 'No report found', undefined, false)
  }
}

/**
 * 設定不備（環境変数の未設定など）。リトライしても直らないので retryable=false（A-11）。
 * 生徒向け文言は AI_RESPONSE_FAILED と同じにする（内部事情は出さない）。
 */
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super('AI_RESPONSE_FAILED', 'error', message, undefined, false)
  }
}

export class ReportChunkSearchFailedError extends AppError {
  constructor(cause?: unknown) {
    super('REPORT_CHUNK_SEARCH_FAILED', 'error', 'Report chunk search failed', cause)
  }
}
