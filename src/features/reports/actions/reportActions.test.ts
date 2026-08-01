/** @file
 * 検証: レポート Server Action の認証ガード・入力検証・Embedding 自動再生成
 * @verifies AC-16-01, AC-16-02, BR-16-02
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'

vi.mock('@shared/lib/auth/requireStaff', () => ({ requireStaff: vi.fn() }))
vi.mock('@shared/lib/auth/requireAdmin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: vi.fn() }))
vi.mock('@features/rag', () => ({
  rebuildReportEmbeddings: vi.fn(),
  getEmbeddingClient: vi.fn(() => ({})),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createReportAction, updateReportAction, rebuildEmbeddingsAction } from './reportActions'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { requireAdmin } from '@shared/lib/auth/requireAdmin'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { rebuildReportEmbeddings } from '@features/rag'

const PERSON_ID = '11111111-1111-4111-8111-111111111111'
const REPORT_ID = '22222222-2222-4222-8222-222222222222'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

const staffOk = () => vi.mocked(requireStaff).mockResolvedValue({ userId: 'u1', email: 'a@b.com' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(rebuildReportEmbeddings).mockResolvedValue(3)
})

describe('createReportAction', () => {
  it('未認証はログイン要求を返す（throw しない）', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('unauthorized'))
    const r = await createReportAction(undefined, fd({ personId: PERSON_ID, reportMonth: '2026-06', title: 't', status: 'draft' }))
    expect(r).toEqual({ ok: false, error: 'ログインが必要です' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('入力不正は fieldErrors を返す', async () => {
    staffOk()
    const r = await createReportAction(undefined, fd({ personId: PERSON_ID, reportMonth: '2026-06', title: '', status: 'draft' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fieldErrors?.title).toBeTruthy()
  })

  it('正常時は insert し embedding を自動再生成、warning=false', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(createMockDb({ single: { data: { id: REPORT_ID }, error: null } }))
    const r = await createReportAction(undefined, fd({ personId: PERSON_ID, reportMonth: '2026-06', title: '6月', status: 'approved' }))
    expect(r).toEqual({ ok: true, data: { reportId: REPORT_ID, embeddingWarning: false } })
    expect(rebuildReportEmbeddings).toHaveBeenCalledOnce()
  })

  it('embedding 失敗でも保存は成功し warning=true', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(createMockDb({ single: { data: { id: REPORT_ID }, error: null } }))
    vi.mocked(rebuildReportEmbeddings).mockRejectedValue(new Error('embed down'))
    const r = await createReportAction(undefined, fd({ personId: PERSON_ID, reportMonth: '2026-06', title: '6月', status: 'draft' }))
    expect(r).toEqual({ ok: true, data: { reportId: REPORT_ID, embeddingWarning: true } })
  })

  it('生徒×月の重複は専用メッセージ', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(createMockDb({ single: { data: null, error: { code: '23505' } } }))
    const r = await createReportAction(undefined, fd({ personId: PERSON_ID, reportMonth: '2026-06', title: '6月', status: 'draft' }))
    expect(r).toEqual({ ok: false, error: 'この生徒のこの月のレポートは既に存在します' })
    expect(rebuildReportEmbeddings).not.toHaveBeenCalled()
  })
})

describe('updateReportAction', () => {
  it('本文が変わった時のみ embedding を再生成する', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(
      createMockDb({ maybeSingle: { data: { body_markdown: 'old' }, error: null }, thenable: { error: null } }),
    )
    const r = await updateReportAction(undefined, fd({ id: REPORT_ID, title: 't', bodyMarkdown: 'new', status: 'approved' }))
    expect(r).toEqual({ ok: true, data: { reportId: REPORT_ID, embeddingWarning: false } })
    expect(rebuildReportEmbeddings).toHaveBeenCalledOnce()
  })

  it('本文が同じなら embedding を再生成しない（無駄な課金を避ける）', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(
      createMockDb({ maybeSingle: { data: { body_markdown: 'same' }, error: null }, thenable: { error: null } }),
    )
    const r = await updateReportAction(undefined, fd({ id: REPORT_ID, title: 't', bodyMarkdown: 'same', status: 'approved' }))
    expect(r.ok).toBe(true)
    expect(rebuildReportEmbeddings).not.toHaveBeenCalled()
  })

  it('本文が同じでも生成済みなら embeddings_updated_at を touch する（誤警告の恒久解消）', async () => {
    staffOk()
    const db = createMockDb({
      maybeSingle: {
        data: { body_markdown: 'same', embeddings_updated_at: '2026-08-01T00:00:00+00:00' },
        error: null,
      },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)
    await updateReportAction(undefined, fd({ id: REPORT_ID, title: '新タイトル', bodyMarkdown: 'same', status: 'approved' }))

    const touch = db.__calls.update.at(-1) as { embeddings_updated_at?: string }
    expect(db.__calls.update).toHaveLength(2)
    expect(Date.parse(touch.embeddings_updated_at ?? '')).toBeGreaterThan(
      Date.parse('2026-08-01T00:00:00+00:00'),
    )
  })

  it('embedding 未生成（null）なら touch しない（生成済みと誤認させない）', async () => {
    staffOk()
    const db = createMockDb({
      maybeSingle: { data: { body_markdown: 'same', embeddings_updated_at: null }, error: null },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)
    await updateReportAction(undefined, fd({ id: REPORT_ID, title: '新タイトル', bodyMarkdown: 'same', status: 'approved' }))

    expect(db.__calls.update).toHaveLength(1)
  })

  it('既存レポートの読み取りエラーは保存失敗にする（本文差分を判定できないため）', async () => {
    staffOk()
    const db = createMockDb({
      maybeSingle: { data: null, error: { message: 'read failed' } },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await updateReportAction(undefined, fd({ id: REPORT_ID, title: 't', bodyMarkdown: 'new', status: 'approved' }))

    expect(r).toEqual({ ok: false, error: '保存に失敗しました' })
    expect(db.__calls.update).toHaveLength(0)
    expect(rebuildReportEmbeddings).not.toHaveBeenCalled()
  })
})

describe('rebuildEmbeddingsAction', () => {
  it('管理者以外は forbidden メッセージ（権限昇格防止）', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('forbidden'))
    const r = await rebuildEmbeddingsAction(undefined, fd({ id: REPORT_ID }))
    expect(r).toEqual({ ok: false, error: 'Embedding 再生成は管理者のみ実行できます' })
    expect(rebuildReportEmbeddings).not.toHaveBeenCalled()
  })

  it('管理者なら再生成を実行する', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ userId: 'admin', email: 'a@b.com' })
    vi.mocked(createServerClient).mockReturnValue(createMockDb())
    const r = await rebuildEmbeddingsAction(undefined, fd({ id: REPORT_ID }))
    expect(r).toEqual({ ok: true })
    expect(rebuildReportEmbeddings).toHaveBeenCalledOnce()
  })
})
