/** @file
 * 機能: OpenAI 互換 Chat Completions API を叩く LlmClient アダプタ
 *       （OpenRouter / DeepSeek / OpenAI など baseURL 切替で共通利用）
 * 入力: apiKey, baseURL / generate(params)
 * 出力: LlmResult
 * 例外: レート制限→AiRateLimitedError / タイムアウト→AiTimeoutError / その他→AiResponseFailedError
 * 依存: openai npm SDK
 * 副作用: 外部 LLM API 呼び出し
 * セキュリティ: API キーはサーバー環境変数のみ。応答をそのまま Slack に出す前に呼び出し側で整形
 * @implements FR-05
 */
import OpenAI from 'openai'
import {
  AiRateLimitedError,
  AiTimeoutError,
  AiResponseFailedError,
} from '@shared/lib/errors/AppError'
import type { LlmClient, LlmGenerateParams, LlmResult, LlmMessage } from './types'

export interface OpenAiCompatibleOptions {
  apiKey: string
  baseURL: string
  /** リクエストタイムアウト（ミリ秒）。既定 60 秒 */
  timeoutMs?: number
}

type OpenAiContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >

function toOpenAiContent(content: LlmMessage['content']): OpenAiContent {
  if (typeof content === 'string') return content
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : { type: 'image_url' as const, image_url: { url: part.dataUrl } },
  )
}

function toChatMessages(system: string | undefined, messages: LlmMessage[]) {
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: OpenAiContent }> = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) out.push({ role: m.role, content: toOpenAiContent(m.content) })
  return out
}

export function createOpenAiCompatibleClient(opts: OpenAiCompatibleOptions): LlmClient {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    timeout: opts.timeoutMs ?? 60_000,
  })

  return {
    async generate(params: LlmGenerateParams): Promise<LlmResult> {
      try {
        const res = await client.chat.completions.create({
          model: params.model,
          messages: toChatMessages(
            params.system,
            params.messages,
          ) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          max_tokens: params.maxTokens,
          temperature: params.temperature,
        })

        const text = res.choices[0]?.message?.content ?? ''
        // 空応答をそのまま Slack に投げると no_text で失敗し無応答になる → 明示エラーにする
        if (!text.trim()) {
          throw new AiResponseFailedError('LLM から空の応答が返りました')
        }
        return {
          text,
          usage: {
            inputTokens: res.usage?.prompt_tokens ?? 0,
            outputTokens: res.usage?.completion_tokens ?? 0,
          },
          model: res.model ?? params.model,
        }
      } catch (err) {
        throw mapOpenAiError(err)
      }
    },
  }
}

export function mapOpenAiError(err: unknown): Error {
  // 既に AppError（空応答等）ならそのまま
  if (
    err instanceof AiResponseFailedError ||
    err instanceof AiRateLimitedError ||
    err instanceof AiTimeoutError
  ) {
    return err
  }
  // タイムアウトは name/status が付かない実装があるため instanceof で判定（openai v6 で確認済み）
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AiTimeoutError()
  const status = (err as { status?: number })?.status
  if (status === 429) return new AiRateLimitedError(err)
  if (status === 408) return new AiTimeoutError()
  return new AiResponseFailedError(err)
}
