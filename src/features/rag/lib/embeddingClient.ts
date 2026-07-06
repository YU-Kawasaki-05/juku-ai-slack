/** @file
 * 機能: プロバイダ非依存の Embedding クライアント（抽象 + OpenAI 互換アダプタ + ファクトリ）
 * 入力: texts / 出力: number[][]（各テキストのベクトル）
 * 例外: 設定未了は AiResponseFailedError、API 失敗も AiResponseFailedError
 * 依存: openai SDK, env
 * セキュリティ: EMBEDDING_API_KEY はサーバー環境変数のみ
 * @implements FR-10
 */
import OpenAI from 'openai'
import { env } from '@shared/lib/env'
import { AiResponseFailedError } from '@shared/lib/errors/AppError'

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>
}

export function createOpenAiCompatibleEmbeddingClient(opts: {
  apiKey: string
  baseURL: string
  model: string
}): EmbeddingClient {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout: 60_000 })
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return []
      try {
        const res = await client.embeddings.create({ model: opts.model, input: texts })
        return res.data.map((d) => d.embedding as number[])
      } catch (err) {
        throw new AiResponseFailedError(err)
      }
    },
  }
}

let cached: EmbeddingClient | undefined

/** env 設定から Embedding クライアントを返す。未設定なら AiResponseFailedError */
export function getEmbeddingClient(): EmbeddingClient {
  if (cached) return cached
  if (!env.EMBEDDING_API_KEY || !env.EMBEDDING_BASE_URL || !env.EMBEDDING_MODEL) {
    throw new AiResponseFailedError('EMBEDDING_* が未設定です（RAG 無効）')
  }
  cached = createOpenAiCompatibleEmbeddingClient({
    apiKey: env.EMBEDDING_API_KEY,
    baseURL: env.EMBEDDING_BASE_URL,
    model: env.EMBEDDING_MODEL,
  })
  return cached
}

export function __setEmbeddingClientForTest(client: EmbeddingClient | undefined): void {
  cached = client
}
