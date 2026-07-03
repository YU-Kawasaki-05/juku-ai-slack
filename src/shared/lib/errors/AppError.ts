export type ErrorSeverity = 'error' | 'warning' | 'info'

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly severity: ErrorSeverity,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ChannelNotBoundError extends AppError {
  constructor() {
    super('CHANNEL_NOT_BOUND', 'warning', 'Channel has no binding')
  }
}

export class PersonNotFoundError extends AppError {
  constructor(channelId: string) {
    super('PERSON_NOT_FOUND', 'error', `No person found for channel ${channelId}`)
  }
}

export class SlackSignatureInvalidError extends AppError {
  constructor() {
    super('SLACK_SIGNATURE_INVALID', 'error', 'Invalid Slack request signature')
  }
}

export class SlackEventDuplicateError extends AppError {
  constructor(eventId: string) {
    super('SLACK_EVENT_DUPLICATE', 'info', `Duplicate event ${eventId}`)
  }
}

export class SlackFileDownloadFailedError extends AppError {
  constructor(cause?: unknown) {
    super('SLACK_FILE_DOWNLOAD_FAILED', 'error', 'Failed to download Slack file', cause)
  }
}

export class UnsupportedFileTypeError extends AppError {
  constructor(fileType: string) {
    super('UNSUPPORTED_FILE_TYPE', 'warning', `Unsupported file type: ${fileType}`)
  }
}

export class ImageTooLargeError extends AppError {
  constructor(sizeBytes: number) {
    super('IMAGE_TOO_LARGE', 'warning', `Image too large: ${sizeBytes} bytes`)
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

export class TokenBudgetExceededError extends AppError {
  constructor() {
    super('TOKEN_BUDGET_EXCEEDED', 'warning', 'Token budget exceeded')
  }
}

export class SlackPostFailedError extends AppError {
  constructor(cause?: unknown) {
    super('SLACK_POST_FAILED', 'error', 'Failed to post Slack message', cause)
  }
}

export class JobTimeoutError extends AppError {
  constructor(jobId: string) {
    super('JOB_TIMEOUT', 'error', `Job ${jobId} timed out`)
  }
}

export class LowConfidenceSkipError extends AppError {
  constructor() {
    super('LOW_CONFIDENCE_SKIP', 'info', 'BKT update skipped due to low confidence')
  }
}

export class ReportNotFoundError extends AppError {
  constructor() {
    super('REPORT_NOT_FOUND', 'info', 'No report found')
  }
}

export class ReportChunkSearchFailedError extends AppError {
  constructor(cause?: unknown) {
    super('REPORT_CHUNK_SEARCH_FAILED', 'error', 'Report chunk search failed', cause)
  }
}
