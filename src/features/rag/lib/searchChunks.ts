/** @file
 * 機能: 質問テキストに関連するレポートチャンクをベクトル検索する
 * 入力: db, EmbeddingClient, { personId, queryText, topK, threshold }
 * 出力: RagChunk[]（similarity 降順）
 * 例外: embedding/検索失敗は伝播（呼び出し側が REPORT_CHUNK_SEARCH_FAILED で継続）
 * 依存: match_report_chunks RPC（migration 020）
 * 副作用: なし（読み取り + embedding API）
 * セキュリティ: person_id で厳密フィルタ（BR-10-03）。RPC 側でも is_ai_reference/status を除外
 * @implements FR-10, AC-10-02, AC-10-03, AC-10-04, BR-10-03〜06
 */
import type { ServerDb } from '@shared/types/db'
import { RAG_TOP_K, RAG_SIMILARITY_THRESHOLD } from '@shared/lib/constants'
import type { EmbeddingClient } from './embeddingClient'

export interface RagChunk {
  id: string
  reportId: string
  content: string
  similarity: number
}

export interface SearchChunksParams {
  personId: string
  queryText: string
  topK?: number
  threshold?: number
}

export async function searchChunks(
  db: ServerDb,
  embeddingClient: EmbeddingClient,
  params: SearchChunksParams,
): Promise<RagChunk[]> {
  const [vector] = await embeddingClient.embed([params.queryText])
  if (!vector) return []

  const { data, error } = await db.rpc('match_report_chunks', {
    p_person_id: params.personId,
    // pgvector は text 形式 `[...]` を受け付ける（生成型も string）
    p_query_embedding: JSON.stringify(vector),
    p_top_k: params.topK ?? RAG_TOP_K,
    p_threshold: params.threshold ?? RAG_SIMILARITY_THRESHOLD,
  })
  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    reportId: row.report_id,
    content: row.content,
    similarity: row.similarity,
  }))
}
