/** @file
 * 検証: Embedding クライアント（encoding_format 明示 / 件数・次元検証 / index ソート / 未設定エラー型）
 * @verifies FR-10, BR-10-07
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EMBEDDING_DIM } from '@shared/lib/constants'

const embeddingsCreate = vi.hoisted(() => vi.fn())
vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = { create: embeddingsCreate }
  },
}))

import {
  createOpenAiCompatibleEmbeddingClient,
  getEmbeddingClient,
  EmbeddingNotConfiguredError,
  __setEmbeddingClientForTest,
} from './embeddingClient'

const vec = (fill: number) => Array.from({ length: EMBEDDING_DIM }, () => fill)

const client = createOpenAiCompatibleEmbeddingClient({
  apiKey: 'k',
  baseURL: 'https://embed.test/v1',
  model: 'test-embed',
})

beforeEach(() => {
  embeddingsCreate.mockReset()
})

describe('createOpenAiCompatibleEmbeddingClient', () => {
  it('encoding_format: float を明示する（SDK の base64 自動デコードで全ゼロ化するのを防ぐ）', async () => {
    embeddingsCreate.mockResolvedValue({ data: [{ index: 0, embedding: vec(0.1) }] })
    await client.embed(['a'])
    expect(embeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ encoding_format: 'float', input: ['a'], model: 'test-embed' }),
    )
  })

  it('空配列は API を呼ばない', async () => {
    expect(await client.embed([])).toEqual([])
    expect(embeddingsCreate).not.toHaveBeenCalled()
  })

  it('返却ベクトル数がテキスト数と一致しなければ throw する（NULL embedding の無言 INSERT 防止）', async () => {
    embeddingsCreate.mockResolvedValue({ data: [{ index: 0, embedding: vec(0.1) }] })
    await expect(client.embed(['a', 'b'])).rejects.toMatchObject({
      code: 'AI_RESPONSE_FAILED',
    })
  })

  it('res.data を index 昇順にソートしてから返す（本文とベクトルの入れ違い防止）', async () => {
    embeddingsCreate.mockResolvedValue({
      data: [
        { index: 2, embedding: vec(0.3) },
        { index: 0, embedding: vec(0.1) },
        { index: 1, embedding: vec(0.2) },
      ],
    })
    const out = await client.embed(['a', 'b', 'c'])
    expect(out.map((v) => v[0])).toEqual([0.1, 0.2, 0.3])
  })

  it('次元が EMBEDDING_DIM と違えば設定エラーとして throw する', async () => {
    embeddingsCreate.mockResolvedValue({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })
    await expect(client.embed(['a'])).rejects.toThrow(/dimension mismatch/)
  })

  it('API 例外は AiResponseFailedError に正規化する', async () => {
    embeddingsCreate.mockRejectedValue(new Error('boom'))
    await expect(client.embed(['a'])).rejects.toMatchObject({ code: 'AI_RESPONSE_FAILED' })
  })
})

describe('getEmbeddingClient', () => {
  it('EMBEDDING_* 未設定は EmbeddingNotConfiguredError（severity=info。ログ洪水を避けるため専用型）', () => {
    __setEmbeddingClientForTest(undefined)
    let thrown: unknown
    try {
      getEmbeddingClient()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(EmbeddingNotConfiguredError)
    expect(thrown).toMatchObject({ code: 'EMBEDDING_NOT_CONFIGURED', severity: 'info' })
  })
})
