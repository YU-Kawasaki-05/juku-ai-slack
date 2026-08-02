/** @file
 * 検証: 滞留ジョブの回収（A-1 後半）と保持期間掃除（A-14）
 * @verifies A-1, A-14, AC-04-03
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createQueuedDb } from '@/test/mocks/queuedDb'
import {
  JOB_PENDING_TIMEOUT_MIN,
  JOB_PROCESSING_TIMEOUT_MIN,
  JOB_RETENTION_DAYS,
  RECEIPT_RETENTION_DAYS,
} from '@shared/lib/constants'

const mocks = vi.hoisted(() => ({ logError: vi.fn() }))
vi.mock('@features/error-logs', () => ({ logError: mocks.logError }))

import { sweepStaleJobs, cleanupOldRows, runJobMaintenance, SWEEP_BATCH_LIMIT } from './sweepStaleJobs'

const NOW = new Date('2026-08-02T12:00:00.000Z')
const PERSON = '00000000-0000-0000-0000-000000000001'

function payload(overrides: Record<string, unknown> = {}) {
  return {
    teamId: 'T1',
    channelId: 'C1',
    messageTs: '100.1',
    threadTs: '100.1',
    userId: 'U1',
    text: 'hi',
    personId: PERSON,
    reportId: null,
    eventId: 'Ev1',
    ...overrides,
  }
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    payload: payload(),
    started_at: '2026-08-02T11:40:00.000Z',
    created_at: '2026-08-02T11:39:00.000Z',
    attempt_count: 1,
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('sweepStaleJobs', () => {
  it('processing のまま閾値超過のジョブを failed + JOB_TIMEOUT にする', async () => {
    const db = createQueuedDb([
      { data: [jobRow()], error: null }, // processing の候補
      { data: [{ id: 'job-1' }], error: null }, // failed 化（CAS 成功）
      { data: [], error: null }, // pending の候補なし
    ])

    const result = await sweepStaleJobs(db, NOW)

    expect(result).toEqual({ stuckProcessing: 1, orphanPending: 0, total: 1 })
    const [select, update] = db.__for('jobs')
    expect(select.filterValue('eq', 'status')).toBe('processing')
    // 閾値は started_at で判定（10分前）
    expect(select.filterValue('lt', 'started_at')).toBe('2026-08-02T11:50:00.000Z')
    expect(select.limit).toBe(SWEEP_BATCH_LIMIT)
    expect(update.values).toEqual({
      status: 'failed',
      error_code: 'JOB_TIMEOUT',
      finished_at: NOW.toISOString(),
    })
    // CAS: 直前に完了したジョブを踏まないよう元 status を条件に付ける
    expect(update.filterValue('eq', 'status')).toBe('processing')
    expect(update.filterValue('eq', 'id')).toBe('job-1')
  })

  it('JOB_TIMEOUT のエラーログに job/channel/thread の情報を残す', async () => {
    const db = createQueuedDb([
      { data: [jobRow({ id: 'job-9' })], error: null },
      { data: [{ id: 'job-9' }], error: null },
      { data: [], error: null },
    ])

    await sweepStaleJobs(db, NOW)

    expect(mocks.logError).toHaveBeenCalledTimes(1)
    const params = mocks.logError.mock.calls[0][1]
    expect(params).toMatchObject({
      code: 'JOB_TIMEOUT',
      severity: 'error',
      personId: PERSON,
      channelId: 'C1',
      threadTs: '100.1',
      messageTs: '100.1',
    })
    expect(params.internalMessage).toContain('job-9')
    expect(params.internalMessage).toContain(String(JOB_PROCESSING_TIMEOUT_MIN))
  })

  it('CAS が 0 行なら（処理が完了していたら）回収せずログも残さない', async () => {
    const db = createQueuedDb([
      { data: [jobRow()], error: null },
      { data: [], error: null }, // 直前に completed になっていた
      { data: [], error: null },
    ])

    const result = await sweepStaleJobs(db, NOW)

    expect(result.total).toBe(0)
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('pending のまま閾値超過の孤児ジョブも created_at 基準で回収する', async () => {
    const db = createQueuedDb([
      { data: [], error: null }, // processing なし
      { data: [jobRow({ id: 'job-2', started_at: null })], error: null },
      { data: [{ id: 'job-2' }], error: null },
    ])

    const result = await sweepStaleJobs(db, NOW)

    expect(result).toEqual({ stuckProcessing: 0, orphanPending: 1, total: 1 })
    const [, pendingSelect, update] = db.__for('jobs')
    expect(pendingSelect.filterValue('eq', 'status')).toBe('pending')
    // 15分前
    expect(pendingSelect.filterValue('lt', 'created_at')).toBe('2026-08-02T11:45:00.000Z')
    expect(update.filterValue('eq', 'status')).toBe('pending')
    expect(mocks.logError.mock.calls[0][1].internalMessage).toContain(String(JOB_PENDING_TIMEOUT_MIN))
  })

  it('payload が不正でも回収は続行し、対象情報は null で記録する', async () => {
    const db = createQueuedDb([
      { data: [jobRow({ payload: { broken: true } })], error: null },
      { data: [{ id: 'job-1' }], error: null },
      { data: [], error: null },
    ])

    const result = await sweepStaleJobs(db, NOW)

    expect(result.stuckProcessing).toBe(1)
    expect(mocks.logError.mock.calls[0][1]).toMatchObject({
      code: 'JOB_TIMEOUT',
      personId: null,
      channelId: null,
    })
  })

  it('閾値内のジョブしかなければ何もしない', async () => {
    const db = createQueuedDb([
      { data: [], error: null },
      { data: [], error: null },
    ])
    expect(await sweepStaleJobs(db, NOW)).toEqual({
      stuckProcessing: 0,
      orphanPending: 0,
      total: 0,
    })
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('select の DB エラーは伝播する', async () => {
    const db = createQueuedDb([{ data: null, error: { message: 'boom' } }])
    await expect(sweepStaleJobs(db, NOW)).rejects.toThrow(/boom/)
  })
})

describe('cleanupOldRows', () => {
  it('receipts 30日超・jobs 完了系 7日超を削除して件数を返す', async () => {
    const db = createQueuedDb([
      { count: 12, error: null },
      { count: 3, error: null },
    ])

    const result = await cleanupOldRows(db, NOW)

    expect(result).toEqual({ receipts: 12, jobs: 3, total: 15 })

    const [receipts] = db.__for('slack_event_receipts')
    expect(receipts.op).toBe('delete')
    expect(receipts.options).toEqual({ count: 'exact' })
    expect(receipts.filterValue('lt', 'received_at')).toBe(
      new Date(NOW.getTime() - RECEIPT_RETENTION_DAYS * 86_400_000).toISOString(),
    )

    const [jobs] = db.__for('jobs')
    expect(jobs.op).toBe('delete')
    expect(jobs.filterValue('lt', 'created_at')).toBe(
      new Date(NOW.getTime() - JOB_RETENTION_DAYS * 86_400_000).toISOString(),
    )
    // 未完了ジョブ（pending/processing）は日付に関係なく残す
    expect(jobs.filterValue('in', 'status')).toEqual(['completed', 'skipped', 'failed'])
  })

  it('count が null でも 0 件として扱う', async () => {
    const db = createQueuedDb([{ error: null }, { error: null }])
    expect(await cleanupOldRows(db, NOW)).toEqual({ receipts: 0, jobs: 0, total: 0 })
  })

  it('DB エラーは伝播する', async () => {
    const db = createQueuedDb([{ error: { message: 'delete failed' } }])
    await expect(cleanupOldRows(db, NOW)).rejects.toThrow(/delete failed/)
  })
})

describe('runJobMaintenance', () => {
  it('回収 → 掃除の順に実行して両方の件数を返す', async () => {
    const db = createQueuedDb([
      { data: [jobRow()], error: null },
      { data: [{ id: 'job-1' }], error: null },
      { data: [], error: null },
      { count: 5, error: null },
      { count: 2, error: null },
    ])

    const result = await runJobMaintenance(db, NOW)

    expect(result.swept.total).toBe(1)
    expect(result.cleaned.total).toBe(7)
    // 掃除より先に回収する（回収直後の failed 行が掃除で消えないこと）
    const tables = db.__queries.map((q) => `${q.table}:${q.op}`)
    expect(tables.indexOf('jobs:update')).toBeLessThan(tables.indexOf('slack_event_receipts:delete'))
  })
})
