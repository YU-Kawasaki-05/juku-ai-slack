/** @file
 * 機能: レポートのチャンクと embedding を再生成する（DEC-14 / BR-10-07）
 * 入力: db, EmbeddingClient, reportId
 * 出力: 生成したチャンク数
 * 例外: レポート不在/embedding 失敗/件数不一致は伝播
 * 依存: reports, report_chunks, chunkReport, EmbeddingClient, rebuild_report_chunks RPC（migration 027）
 * 副作用: RPC 内で 旧チャンク削除 → 新チャンク挿入 → reports.embeddings_updated_at 更新（1トランザクション）
 * セキュリティ: person_id は RPC 内で reports から引く（クライアント値を信用しない, BR-10-03）
 * @implements FR-10, BR-10-07, AC-10-01
 */
import type { ServerDb } from '@shared/types/db'
import { ReportNotFoundError } from '@shared/lib/errors/AppError'
import { EmbeddingResponseInvalidError, type EmbeddingClient } from './embeddingClient'
import { chunkReport } from './chunkReport'

export async function rebuildReportEmbeddings(
  db: ServerDb,
  embeddingClient: EmbeddingClient,
  reportId: string,
): Promise<number> {
  const { data: report, error: readError } = await db
    .from('reports')
    .select('id, body_markdown')
    .eq('id', reportId)
    .maybeSingle()
  if (readError) throw readError
  if (!report) throw new ReportNotFoundError()

  const chunks = chunkReport(report.body_markdown ?? '')

  // embed を先に実行する。失敗しても既存チャンクを消さない（データ損失防止）
  const vectors = chunks.length > 0 ? await embedInBatches(embeddingClient, chunks) : []
  // 数が合わないまま INSERT すると embedding NULL のチャンクが無言で作られ、
  // match_report_chunks の IS NOT NULL で永久に検索対象外になる（しかも成功扱い）
  if (vectors.length !== chunks.length) {
    throw new EmbeddingResponseInvalidError(
      `embedding count mismatch: chunks=${chunks.length}, vectors=${vectors.length}`,
    )
  }

  // embed 完了後に採取する。embed 前に採取すると reports.updated_at より古い時刻が入り、
  // 詳細ページの「再生成が必要」警告が消えなくなる（H-1）
  const nowIso = new Date().toISOString()

  // 削除・挿入・embeddings_updated_at 更新を1トランザクション化し、
  // 同一レポートに対する並行再生成を advisory lock で直列化する（migration 027）
  const { error: rpcError } = await db.rpc('rebuild_report_chunks', {
    p_report_id: reportId,
    p_chunks: chunks.map((content, i) => ({
      chunk_index: i,
      content,
      // pgvector は text 形式 `[...]` を受け付ける
      embedding: JSON.stringify(vectors[i]),
    })),
    p_updated_at: nowIso,
  })
  if (rpcError) throw rpcError

  return chunks.length
}

/** プロバイダのバッチ上限を避けるため分割して embed する */
const EMBED_BATCH_SIZE = 96
async function embedInBatches(
  client: EmbeddingClient,
  texts: string[],
): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = await client.embed(texts.slice(i, i + EMBED_BATCH_SIZE))
    out.push(...batch)
  }
  return out
}
