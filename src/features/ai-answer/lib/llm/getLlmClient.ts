/** @file
 * 機能: env からプロバイダ設定を読み、LlmClient を生成するファクトリ
 * 出力: LlmClient
 * 例外: LLM 設定が未設定なら AiResponseFailedError（呼び出し時に判明）
 * 依存: env, openaiCompatibleClient
 * セキュリティ: LLM_API_KEY はサーバー環境変数のみ
 * @implements FR-05
 */
import { env } from '@shared/lib/env'
import { AiResponseFailedError } from '@shared/lib/errors/AppError'
import type { LlmClient } from './types'
import { createOpenAiCompatibleClient } from './openaiCompatibleClient'

let cached: LlmClient | undefined

/**
 * 現在のプロバイダ設定に基づく LlmClient を返す。
 * MVP は OpenAI 互換のみ（OpenRouter / DeepSeek / OpenAI）。
 * 別プロバイダ（Anthropic 直等）を足す場合はここで分岐する。
 */
export function getLlmClient(): LlmClient {
  if (cached) return cached
  if (!env.LLM_API_KEY || !env.LLM_BASE_URL) {
    throw new AiResponseFailedError('LLM_API_KEY / LLM_BASE_URL が未設定です')
  }
  cached = createOpenAiCompatibleClient({
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
  })
  return cached
}

/** テスト用: キャッシュした client を差し替える */
export function __setLlmClientForTest(client: LlmClient | undefined): void {
  cached = client
}
