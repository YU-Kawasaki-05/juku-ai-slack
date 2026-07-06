/** @file
 * 検証: RAG チャンク検索（person_id フィルタ・RPC 引数・結果整形）
 * @verifies FR-10, AC-10-02, BR-10-03
 */
import { describe, it, expect, vi } from 'vitest'
import { searchChunks } from './searchChunks'
import { RAG_TOP_K, RAG_SIMILARITY_THRESHOLD } from '@shared/lib/constants'
import type { EmbeddingClient } from './embeddingClient'

function mockDbWithRpc(rows: unknown[], error: unknown = null) {
  const rpc = vi.fn(async () => ({ data: rows, error }))
  return { db: { rpc } as never, rpc }
}

const embedder: EmbeddingClient = { embed: vi.fn(async () => [[0.1, 0.2, 0.3]]) }

describe('searchChunks', () => {
  it('RPC に person_id / embedding / top_k / threshold を渡し結果を整形する', async () => {
    const { db, rpc } = mockDbWithRpc([
      { id: 'c1', report_id: 'r1', content: '二次方程式の記録', similarity: 0.82 },
    ])
    const chunks = await searchChunks(db, embedder, { personId: 'p1', queryText: '二次方程式' })

    expect(chunks).toEqual([
      { id: 'c1', reportId: 'r1', content: '二次方程式の記録', similarity: 0.82 },
    ])
    expect(rpc).toHaveBeenCalledWith(
      'match_report_chunks',
      expect.objectContaining({
        p_person_id: 'p1',
        p_top_k: RAG_TOP_K,
        p_threshold: RAG_SIMILARITY_THRESHOLD,
        p_query_embedding: JSON.stringify([0.1, 0.2, 0.3]),
      }),
    )
  })

  it('embedding が空なら空配列（RPC を呼ばない）', async () => {
    const { db, rpc } = mockDbWithRpc([])
    const emptyEmbedder: EmbeddingClient = { embed: vi.fn(async () => []) }
    const chunks = await searchChunks(db, emptyEmbedder, { personId: 'p1', queryText: 'x' })
    expect(chunks).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('RPC エラーは伝播（呼び出し側が REPORT_CHUNK_SEARCH_FAILED で継続）', async () => {
    const { db } = mockDbWithRpc([], { message: 'boom' })
    await expect(
      searchChunks(db, embedder, { personId: 'p1', queryText: 'x' }),
    ).rejects.toBeTruthy()
  })
})
