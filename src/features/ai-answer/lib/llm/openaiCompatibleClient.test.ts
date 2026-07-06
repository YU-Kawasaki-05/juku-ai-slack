/** @file
 * 検証: OpenAI 互換アダプタのエラーマッピング
 * @verifies FR-05, AI_TIMEOUT / AI_RATE_LIMITED / AI_RESPONSE_FAILED の区別
 */
import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { mapOpenAiError } from './openaiCompatibleClient'

describe('mapOpenAiError', () => {
  it('タイムアウト（APIConnectionTimeoutError）→ AI_TIMEOUT', () => {
    const err = new OpenAI.APIConnectionTimeoutError({ message: 'timeout' })
    expect(mapOpenAiError(err).message).toBeDefined()
    expect((mapOpenAiError(err) as { code?: string }).code).toBe('AI_TIMEOUT')
  })

  it('status 429 → AI_RATE_LIMITED', () => {
    expect((mapOpenAiError({ status: 429 }) as { code?: string }).code).toBe('AI_RATE_LIMITED')
  })

  it('status 408 → AI_TIMEOUT', () => {
    expect((mapOpenAiError({ status: 408 }) as { code?: string }).code).toBe('AI_TIMEOUT')
  })

  it('その他 → AI_RESPONSE_FAILED', () => {
    expect((mapOpenAiError({ status: 500 }) as { code?: string }).code).toBe('AI_RESPONSE_FAILED')
    expect((mapOpenAiError(new Error('x')) as { code?: string }).code).toBe('AI_RESPONSE_FAILED')
  })
})
