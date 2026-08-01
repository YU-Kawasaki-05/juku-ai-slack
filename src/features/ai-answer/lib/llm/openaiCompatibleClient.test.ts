/** @file
 * 検証: OpenAI 互換アダプタのエラーマッピング・リトライ設定・打ち切り検出
 * @verifies FR-05, AI_TIMEOUT / AI_RATE_LIMITED / AI_RESPONSE_FAILED の区別, A-10, A-15
 */
import { describe, it, expect, vi } from 'vitest'

/** OpenAI コンストラクタに渡される設定を覗くためのスパイ（A-10 の検証用） */
const spy = vi.hoisted(() => ({ openAiOptions: [] as Record<string, unknown>[] }))
vi.mock('openai', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: new (o: unknown) => unknown }
  const Real = actual.default
  // 実クライアントは jsdom 環境で生成を拒否する（ブラウザ検出）ため、設定の記録だけを行う代替を返す。
  // 静的メンバ（APIConnectionTimeoutError 等）はプロトタイプチェーンで実物を引き継ぐ
  class SpiedOpenAI {
    chat = { completions: { create: vi.fn() } }
    constructor(options: Record<string, unknown>) {
      spy.openAiOptions.push(options)
    }
  }
  Object.setPrototypeOf(SpiedOpenAI, Real)
  return { ...actual, default: SpiedOpenAI }
})

import OpenAI from 'openai'
import {
  mapOpenAiError,
  isTruncated,
  createOpenAiCompatibleClient,
} from './openaiCompatibleClient'

const capturedOpenAiOptions = spy.openAiOptions

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

describe('isTruncated（A-15 / G-3）', () => {
  it("finish_reason='length' を打ち切りとみなす", () => {
    expect(isTruncated({ finish_reason: 'length' })).toBe(true)
  })
  it("Anthropic 互換ゲートウェイの 'max_tokens' も打ち切り扱い", () => {
    expect(isTruncated({ finish_reason: 'max_tokens' })).toBe(true)
  })
  it('stop / 未指定は打ち切りでない', () => {
    expect(isTruncated({ finish_reason: 'stop' })).toBe(false)
    expect(isTruncated({})).toBe(false)
    expect(isTruncated(undefined)).toBe(false)
  })
})

describe('createOpenAiCompatibleClient（A-10）', () => {
  it('SDK 内蔵リトライを無効化する（ジョブ側 3 attempts との掛け算で 9 回呼ぶのを防ぐ）', () => {
    const client = createOpenAiCompatibleClient({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
    }) as unknown as { generate: unknown }
    expect(client.generate).toBeTypeOf('function')

    // アダプタが内部で生成する OpenAI インスタンスの設定を確認する
    const inner = capturedOpenAiOptions.at(-1)
    expect(inner?.maxRetries).toBe(0)
    expect(inner?.timeout).toBe(60_000)
  })
})
