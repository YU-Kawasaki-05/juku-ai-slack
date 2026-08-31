/** @file
 * 機能: プロバイダ非依存の Embedding クライアント（抽象 + OpenAI 互換アダプタ + ファクトリ）
 * 入力: texts / 出力: number[][]（各テキストのベクトル）
 * 例外: 設定未了は EmbeddingNotConfiguredError（severity=info）、API 失敗は AiResponseFailedError、
 *   応答の件数・次元異常は EmbeddingResponseInvalidError（code は AI_RESPONSE_FAILED のまま）
 * 依存: openai SDK, env, EMBEDDING_DIM
 * セキュリティ: EMBEDDING_API_KEY はサーバー環境変数のみ
 * @implements FR-10
 */
import OpenAI from 'openai'
import { env } from '@shared/lib/env'
import { AppError, AiResponseFailedError } from '@shared/lib/errors/AppError'
import { EMBEDDING_DIM } from '@shared/lib/constants'

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>
}

/**
 * EMBEDDING_* 未設定（= RAG 機能そのものが無効）。
 * 「毎メッセージのエラーログ洪水」を避けるため、呼び出し側はこの型を検出して
 * logError をスキップできる（設定不備は起動時／管理画面で扱う運用）。
 */
export class EmbeddingNotConfiguredError extends AppError {
  constructor() {
    super(
      'EMBEDDING_NOT_CONFIGURED',
      'info',
      'EMBEDDING_API_KEY / EMBEDDING_BASE_URL / EMBEDDING_MODEL が未設定です（RAG 無効）',
    )
  }
}

/**
 * Embedding 応答が想定と違う（件数不一致・次元不一致）。
 * AiResponseFailedError はメッセージが固定でどこが壊れたか分からないため、
 * 同じ error_code のまま原因を message に残せる派生型を用意する。
 */
export class EmbeddingResponseInvalidError extends AppError {
  constructor(message: string, cause?: unknown) {
    super('AI_RESPONSE_FAILED', 'error', message, cause)
  }
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

      let res: Awaited<ReturnType<typeof client.embeddings.create>>
      try {
        res = await client.embeddings.create({
          model: opts.model,
          input: texts,
          // 明示必須: openai SDK v6 は未指定だと base64 を要求して無条件にデコードするため、
          // float 配列を返すプロバイダでは全ゼロベクトルへ静かに化ける
          encoding_format: 'float',
        })
      } catch (err) {
        throw new AiResponseFailedError(err)
      }

      const data = res.data ?? []
      // 件数不一致のまま進むと本文とベクトルの対応が崩れ、embedding NULL のチャンクが無言で作られる
      if (data.length !== texts.length) {
        throw new EmbeddingResponseInvalidError(
          `embedding count mismatch: requested ${texts.length}, received ${data.length}`,
        )
      }

      // 順序を保証しないプロバイダで本文とベクトルが入れ違うのを防ぐ
      const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

      return sorted.map((d) => {
        const vector = d.embedding as unknown as number[]
        if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIM) {
          // DB は vector(1536) 固定。ここで落とさないと検索が常に 0 件になる設定ミスが表面化しない
          throw new EmbeddingResponseInvalidError(
            `embedding dimension mismatch: model "${opts.model}" returned ` +
              `${Array.isArray(vector) ? vector.length : 'non-array'} dims, expected ${EMBEDDING_DIM}. ` +
              'EMBEDDING_MODEL の設定を見直してください',
          )
        }
        return vector
      })
    },
  }
}

let cached: EmbeddingClient | undefined

/** env 設定から Embedding クライアントを返す。未設定なら EmbeddingNotConfiguredError */
export function getEmbeddingClient(): EmbeddingClient {
  if (cached) return cached
  if (!env.EMBEDDING_API_KEY || !env.EMBEDDING_BASE_URL || !env.EMBEDDING_MODEL) {
    throw new EmbeddingNotConfiguredError()
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
