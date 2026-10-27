/** @file
 * 検証: 「先月分を今すぐ作成して送る」Server Action の認可（admin 限定）と結果の受け渡し
 * @verifies FR-08, FR-13
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@shared/lib/auth/requireAdmin', () => ({ requireAdmin: vi.fn() }))
vi.mock('../lib/runtime', () => ({ runManualMonthlyReports: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { generateMonthlyReportsAction } from './monthlyReportActions'
import { requireAdmin } from '@shared/lib/auth/requireAdmin'
import { runManualMonthlyReports } from '../lib/runtime'
import { revalidatePath } from 'next/cache'

const RESULT = {
  month: '2026-09',
  students: 3,
  noQuestions: 1,
  generated: 2,
  alreadyGenerated: 0,
  manualExisting: 0,
  failed: 0,
  remaining: 0,
  stoppedBy: null,
  generationBlocked: null,
  embeddingFailed: 0,
  mail: 'sent' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(runManualMonthlyReports).mockResolvedValue(RESULT)
})

describe('generateMonthlyReportsAction', () => {
  it('未認証はログイン要求を返し、何も実行しない', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('unauthorized'))
    expect(await generateMonthlyReportsAction()).toEqual({ ok: false, error: 'ログインが必要です' })
    expect(runManualMonthlyReports).not.toHaveBeenCalled()
  })

  it('staff（admin 以外）は実行できない', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('forbidden'))
    expect(await generateMonthlyReportsAction()).toEqual({
      ok: false,
      error: '月次レポートの作成・送信は管理者のみ実行できます',
    })
    expect(runManualMonthlyReports).not.toHaveBeenCalled()
  })

  it('admin なら cron と同じ処理（手動版）を実行し、結果の日本語メッセージを返す', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ userId: 'u1', email: 'a@b.com', role: 'admin' })
    const r = await generateMonthlyReportsAction()
    expect(runManualMonthlyReports).toHaveBeenCalledOnce()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data?.message).toContain('2026年9月分')
      expect(r.data?.message).toContain('メール: 送信しました')
    }
    expect(revalidatePath).toHaveBeenCalledWith('/admin/reports')
  })

  it('実行中の例外は ActionResult のエラーにする（内部情報は出さない）', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ userId: 'u1', email: 'a@b.com', role: 'admin' })
    vi.mocked(runManualMonthlyReports).mockRejectedValue(new Error('db password=secret'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await generateMonthlyReportsAction()
    expect(r).toEqual({ ok: false, error: '実行に失敗しました。時間を置いて再度お試しください' })
    err.mockRestore()
  })
})
