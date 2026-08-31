/** @file
 * 検証: ジョブ管理 Server Action の認証ガード・二重返信ガード・再実行起動
 * @verifies F-4, A-1, A-14, FR-13
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'

const mocks = vi.hoisted(() => ({
  afterCbs: [] as Array<() => unknown>,
  processJob: vi.fn(),
  retryJob: vi.fn(),
  runJobMaintenance: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('@shared/lib/auth/requireStaff', () => ({ requireStaff: vi.fn() }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: (cb: () => unknown) => mocks.afterCbs.push(cb) }))
vi.mock('@features/error-logs', () => ({ logError: mocks.logError }))
vi.mock('../lib/processJob', () => ({ processJob: mocks.processJob }))
vi.mock('../lib/retryJob', () => ({ retryJob: mocks.retryJob }))
vi.mock('../lib/sweepStaleJobs', () => ({ runJobMaintenance: mocks.runJobMaintenance }))

import { retryJobAction, sweepJobsAction } from './jobActions'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { revalidatePath } from 'next/cache'

const JOB_ID = '11111111-1111-4111-8111-111111111111'

function fd(entries: Record<string, string> = {}): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

const staffOk = () => vi.mocked(requireStaff).mockResolvedValue({ userId: 'u1', email: 'a@b.com', role: 'staff' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.afterCbs.length = 0
  vi.mocked(createServerClient).mockReturnValue(createMockDb())
})

describe('sweepJobsAction', () => {
  it('未認証は実行しない', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('unauthorized'))
    expect(await sweepJobsAction()).toEqual({ ok: false, error: 'ログインが必要です' })
    expect(mocks.runJobMaintenance).not.toHaveBeenCalled()
  })

  it('回収件数と掃除件数をメッセージで返す', async () => {
    staffOk()
    mocks.runJobMaintenance.mockResolvedValue({
      swept: { stuckProcessing: 1, orphanPending: 1, total: 2 },
      cleaned: { receipts: 30, jobs: 10, total: 40 },
    })
    const r = await sweepJobsAction()
    expect(r.ok).toBe(true)
    expect(r.ok && r.data?.message).toBe('滞留ジョブを 2 件回収、古い記録を 40 件掃除しました')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/jobs')
  })

  it('DB エラーでも画面を落とさずエラーメッセージを返す', async () => {
    staffOk()
    mocks.runJobMaintenance.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await sweepJobsAction()).toEqual({
      ok: false,
      error: 'スイープに失敗しました',
    })
  })
})

describe('retryJobAction', () => {
  it('未認証は再実行しない', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('unauthorized'))
    expect(await retryJobAction(undefined, fd({ id: JOB_ID }))).toEqual({
      ok: false,
      error: 'ログインが必要です',
    })
    expect(mocks.retryJob).not.toHaveBeenCalled()
  })

  it('UUID でない ID は弾く（URL 直叩き対策）', async () => {
    staffOk()
    const r = await retryJobAction(undefined, fd({ id: 'not-a-uuid' }))
    expect(r).toEqual({ ok: false, error: '不正なジョブ ID です' })
    expect(mocks.retryJob).not.toHaveBeenCalled()
  })

  it('配信済みなら processJob を起動せず案内を返す（二重返信ガード）', async () => {
    staffOk()
    mocks.retryJob.mockResolvedValue({ kind: 'already_delivered' })

    const r = await retryJobAction(undefined, fd({ id: JOB_ID }))

    expect(r.ok).toBe(true)
    expect(r.ok && r.data?.message).toContain('配信済み')
    expect(mocks.afterCbs).toHaveLength(0)
    expect(mocks.processJob).not.toHaveBeenCalled()
  })

  it('差し戻せたら after() で processJob を起動する', async () => {
    staffOk()
    mocks.retryJob.mockResolvedValue({ kind: 'requeued' })

    const r = await retryJobAction(undefined, fd({ id: JOB_ID }))

    expect(r.ok).toBe(true)
    expect(mocks.afterCbs).toHaveLength(1)
    // レスポンスを返す時点ではまだ走らせない
    expect(mocks.processJob).not.toHaveBeenCalled()
    await mocks.afterCbs[0]()
    expect(mocks.processJob).toHaveBeenCalledWith(expect.anything(), JOB_ID)
  })

  it('after() 内の processJob 失敗は無音にせずエラーログに残す', async () => {
    staffOk()
    mocks.retryJob.mockResolvedValue({ kind: 'requeued' })
    mocks.processJob.mockRejectedValue(new Error('claim failed'))

    await retryJobAction(undefined, fd({ id: JOB_ID }))
    await mocks.afterCbs[0]()

    expect(mocks.logError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'UNKNOWN_ERROR', severity: 'error' }),
    )
    expect(mocks.logError.mock.calls[0][1].internalMessage).toContain(JOB_ID)
  })

  it.each([
    [{ kind: 'not_found' }, '対象のジョブが見つかりません'],
    [{ kind: 'not_retryable', status: 'processing' }, 'processing のジョブは再実行できません（失敗したジョブのみ）'],
    [{ kind: 'invalid_payload' }, 'ジョブの内容が壊れているため再実行できません'],
    [
      { kind: 'conflict' },
      'ジョブの状態が変わったため中止しました。画面を更新してください',
    ],
  ])('%o は再実行せずエラーを返す', async (outcome, error) => {
    staffOk()
    mocks.retryJob.mockResolvedValue(outcome)
    expect(await retryJobAction(undefined, fd({ id: JOB_ID }))).toEqual({ ok: false, error })
    expect(mocks.afterCbs).toHaveLength(0)
  })
})
