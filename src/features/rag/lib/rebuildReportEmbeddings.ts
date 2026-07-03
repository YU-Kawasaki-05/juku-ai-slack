/** @file
 * 機能: レポートのチャンクと embedding を再生成する（DEC-14 / BR-10-07）
 * 入力: db, EmbeddingClient, reportId
 * 出力: 生成したチャンク数
 * 例外: レポート不在/embedding 失敗は伝播
 * 依存: reports, report_chunks, chunkReport, EmbeddingClient
 * 副作用: 古いチャンク削除 → 新チャンク挿入 → reports.embeddings_updated_at 更新
 * セキュリティ: report の person_id をチャンクへ伝播（越境防止, BR-10-03）
 * @implements FR-10, BR-10-07, AC-10-01
 */
import type { ServerDb, TablesInsert } from '@shared/types/db'
import { ReportNotFoundError } from '@shared/lib/errors/AppError'
import type { EmbeddingClient } from './embeddingClient'
import { chunkReport } from './chunkReport'

export async function rebuildReportEmbeddings(
  db: ServerDb,
  embeddingClient: EmbeddingClient,
  reportId: string,
): Promise<number> {
  const { data: report, error: readError } = await db
    .from('reports')
    .select('id, person_id, body_markdown')
    .eq('id', reportId)
    .maybeSingle()
  if (readError) throw readError
  if (!report) throw new ReportNotFoundError()

  // 古いチャンクを削除して作り直す（BR-10-07）
  const { error: delError } = await db.from('report_chunks').delete().eq('report_id', reportId)
  if (delError) throw delError

  const chunks = chunkReport(report.body_markdown ?? '')
  const nowIso = new Date().toISOString()

  if (chunks.length > 0) {
    const vectors = await embeddingClient.embed(chunks)
    const rows: TablesInsert<'report_chunks'>[] = chunks.map((content, i) => ({
      report_id: reportId,
      person_id: report.person_id,
      chunk_index: i,
      content,
      // pgvector は text 形式 `[...]`（生成型も string）
      embedding: JSON.stringify(vectors[i]),
    }))
    const { error: insError } = await db.from('report_chunks').insert(rows)
    if (insError) throw insError
  }

  const { error: updError } = await db
    .from('reports')
    .update({ embeddings_updated_at: nowIso })
    .eq('id', reportId)
  if (updError) throw updError

  return chunks.length
}
