/** @file
 * 検証: レポート embedding 再生成（RPC 1トランザクション化 / 件数不一致検出 / nowIso の採取順）
 * @verifies FR-10, BR-10-07, AC-10-01
 */
import { describe, it, expect, vi } from 'vitest'
import { rebuildReportEmbeddings } from './rebuildReportEmbeddings'
import type { EmbeddingClient } from './embeddingClient'

const REPORT_ID = '33333333-3333-4333-8333-333333333333'

function mockDb(opts: {
  report?: { id: string; body_markdown: string | null } | null
  readError?: unknown
  rpcError?: unknown
}) {
  const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<unknown>>(async () => ({
    data: 0,
    error: opts.rpcError ?? null,
  }))
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({
      data: opts.report === undefined ? { id: REPORT_ID, body_markdown: '本文' } : opts.report,
      error: opts.readError ?? null,
    })),
  }
  const db = { from: vi.fn(() => builder), rpc }
  return { db: db as never, rpc, builder }
}

const embedder = (vectors: number[][]): EmbeddingClient => ({ embed: vi.fn(async () => vectors) })

describe('rebuildReportEmbeddings', () => {
  it('rebuild_report_chunks RPC に chunk_index / content / embedding を渡す（DELETE+INSERT の分離をやめる）', async () => {
    const { db, rpc } = mockDb({ report: { id: REPORT_ID, body_markdown: '## A\n本文A' } })
    const count = await rebuildReportEmbeddings(db, embedder([[0.1, 0.2]]), REPORT_ID)

    expect(count).toBe(1)
    expect(rpc).toHaveBeenCalledWith(
      'rebuild_report_chunks',
      expect.objectContaining({
        p_report_id: REPORT_ID,
        p_chunks: [{ chunk_index: 0, content: '## A\n本文A', embedding: '[0.1,0.2]' }],
      }),
    )
  })

  it('ベクトル数がチャンク数に足りなければ throw し RPC を呼ばない（NULL embedding 防止）', async () => {
    const { db, rpc } = mockDb({ report: { id: REPORT_ID, body_markdown: '## A\nあ\n\n## B\nい' } })
    await expect(rebuildReportEmbeddings(db, embedder([[0.1]]), REPORT_ID)).rejects.toMatchObject({
      code: 'AI_RESPONSE_FAILED',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('p_updated_at は embed 完了後の時刻（reports.updated_at より前にならない）', async () => {
    const { db, rpc } = mockDb({ report: { id: REPORT_ID, body_markdown: '本文' } })
    const embedFinishedAt: number[] = []
    const slowEmbedder: EmbeddingClient = {
      embed: async (texts) => {
        await new Promise((r) => setTimeout(r, 5))
        embedFinishedAt.push(Date.now())
        return texts.map(() => [0.1])
      },
    }
    await rebuildReportEmbeddings(db, slowEmbedder, REPORT_ID)

    const args = rpc.mock.calls[0][1] as { p_updated_at: string }
    expect(Date.parse(args.p_updated_at)).toBeGreaterThanOrEqual(embedFinishedAt[0])
  })

  it('本文が空ならチャンク 0 件で RPC を呼ぶ（embeddings_updated_at は更新される）', async () => {
    const { db, rpc } = mockDb({ report: { id: REPORT_ID, body_markdown: '' } })
    const embed = vi.fn()
    const count = await rebuildReportEmbeddings(db, { embed }, REPORT_ID)
    expect(count).toBe(0)
    expect(embed).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('rebuild_report_chunks', expect.objectContaining({ p_chunks: [] }))
  })

  it('レポート不在は REPORT_NOT_FOUND', async () => {
    const { db } = mockDb({ report: null })
    await expect(rebuildReportEmbeddings(db, embedder([]), REPORT_ID)).rejects.toMatchObject({
      code: 'REPORT_NOT_FOUND',
    })
  })

  it('RPC エラーは伝播する（保存成功と誤認させない）', async () => {
    const { db } = mockDb({
      report: { id: REPORT_ID, body_markdown: '本文' },
      rpcError: { message: 'unique violation' },
    })
    await expect(rebuildReportEmbeddings(db, embedder([[0.1]]), REPORT_ID)).rejects.toBeTruthy()
  })
})
