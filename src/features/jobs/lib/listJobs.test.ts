/** @file
 * 検証: ジョブ一覧の絞り込み・整形とキュー集計、経過時間表記
 * @verifies F-4
 */
import { describe, it, expect } from 'vitest'
import { createQueuedDb } from '@/test/mocks/queuedDb'
import {
  listJobs,
  getJobQueueStats,
  extractJobTarget,
  resolveStatusFilter,
  DEFAULT_JOB_STATUSES,
  JOB_STATUS_VALUES,
  JOB_LIST_LIMIT,
  JOB_LIST_MAX_LIMIT,
} from './listJobs'
import { formatElapsed } from './formatElapsed'

const payload = {
  teamId: 'T1',
  channelId: 'C1',
  messageTs: '100.1',
  threadTs: '100.1',
  userId: 'U1',
  text: 'hi',
  personId: '00000000-0000-0000-0000-000000000001',
  reportId: null,
  eventId: 'Ev1',
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    job_type: 'process_slack_message',
    status: 'failed',
    attempt_count: 3,
    max_attempts: 3,
    error_code: 'AI_TIMEOUT',
    created_at: '2026-08-02T11:00:00.000Z',
    updated_at: '2026-08-02T11:05:00.000Z',
    started_at: '2026-08-02T11:00:10.000Z',
    finished_at: '2026-08-02T11:05:00.000Z',
    payload,
    result_text: null,
    ...overrides,
  }
}

describe('resolveStatusFilter', () => {
  it('未指定は積み残し（pending/processing/failed）', () => {
    expect(resolveStatusFilter(undefined)).toEqual(DEFAULT_JOB_STATUSES)
  })
  it("'all' は全 status", () => {
    expect(resolveStatusFilter('all')).toEqual(JOB_STATUS_VALUES)
  })
  it('単一 status を指定できる', () => {
    expect(resolveStatusFilter('completed')).toEqual(['completed'])
  })
  it('URL 手編集の不正値は既定に倒す', () => {
    expect(resolveStatusFilter('; drop table jobs')).toEqual(DEFAULT_JOB_STATUSES)
  })
})

describe('extractJobTarget', () => {
  it('payload から channel/thread/message/person を取り出す', () => {
    expect(extractJobTarget(payload)).toEqual({
      channelId: 'C1',
      threadTs: '100.1',
      messageTs: '100.1',
      personId: payload.personId,
    })
  })
  it('不正 payload でも落ちず null を返す（行は一覧に残す）', () => {
    expect(extractJobTarget(null)).toEqual({
      channelId: null,
      threadTs: null,
      messageTs: null,
      personId: null,
    })
    expect(extractJobTarget({ channelId: 42 }).channelId).toBeNull()
  })
})

describe('listJobs', () => {
  it('既定は積み残しのみ・最新順・件数上限を明示する', async () => {
    const db = createQueuedDb([
      { data: [jobRow()], error: null },
      { data: [{ slack_channel_id: 'C1', slack_channel_name: 'study-taro' }], error: null },
    ])

    const items = await listJobs(db)

    const [jobs] = db.__for('jobs')
    expect(jobs.filterValue('in', 'status')).toEqual([...DEFAULT_JOB_STATUSES])
    expect(jobs.filterValue('order', 'created_at')).toEqual({ ascending: false })
    expect(jobs.limit).toBe(JOB_LIST_LIMIT)
    expect(items[0]).toMatchObject({
      id: 'job-1',
      status: 'failed',
      attemptCount: 3,
      errorCode: 'AI_TIMEOUT',
      channelId: 'C1',
      channelName: 'study-taro',
      threadTs: '100.1',
      hasResultText: false,
    })
  })

  it('生成済み回答があれば hasResultText=true（再実行が配信のみで済む目印）', async () => {
    const db = createQueuedDb([
      { data: [jobRow({ result_text: '答えはこう' })], error: null },
      { data: [], error: null },
    ])
    expect((await listJobs(db))[0].hasResultText).toBe(true)
  })

  it('紐付けが無いチャンネルは channelName=null', async () => {
    const db = createQueuedDb([{ data: [jobRow()], error: null }, { data: [], error: null }])
    expect((await listJobs(db))[0].channelName).toBeNull()
  })

  it('limit は上限で頭打ちにする', async () => {
    const db = createQueuedDb([{ data: [], error: null }])
    await listJobs(db, { limit: 99_999 })
    expect(db.__for('jobs')[0].limit).toBe(JOB_LIST_MAX_LIMIT)
  })

  it('channel を持たない行では bindings を引かない', async () => {
    const db = createQueuedDb([{ data: [jobRow({ payload: {} })], error: null }])
    const items = await listJobs(db)
    expect(items[0].channelName).toBeNull()
    expect(db.__for('slack_channel_bindings')).toHaveLength(0)
  })

  it('DB エラーは伝播する', async () => {
    const db = createQueuedDb([{ data: null, error: { message: 'boom' } }])
    await expect(listJobs(db)).rejects.toThrow(/boom/)
  })
})

describe('getJobQueueStats', () => {
  it('pending/processing/failed の件数と最古の滞留時刻を返す', async () => {
    const db = createQueuedDb([
      { data: [{ created_at: '2026-08-02T11:00:00.000Z' }], count: 2, error: null },
      {
        data: [{ started_at: '2026-08-02T10:00:00.000Z', created_at: '2026-08-02T09:59:00.000Z' }],
        count: 1,
        error: null,
      },
      { data: [], count: 0, error: null },
    ])

    const stats = await getJobQueueStats(db)

    expect(stats).toEqual([
      { status: 'pending', count: 2, oldestIso: '2026-08-02T11:00:00.000Z' },
      { status: 'processing', count: 1, oldestIso: '2026-08-02T10:00:00.000Z' },
      { status: 'failed', count: 0, oldestIso: null },
    ])
    // processing だけは started_at 基準で古い順に並べる
    expect(db.__for('jobs')[1].filterValue('order', 'started_at')).toEqual({ ascending: true })
    expect(db.__for('jobs')[0].options).toEqual({ count: 'exact' })
  })

  it('started_at が無い異常な processing 行は created_at にフォールバックする', async () => {
    const db = createQueuedDb([
      { data: [], count: 0, error: null },
      { data: [{ started_at: null, created_at: '2026-08-02T08:00:00.000Z' }], count: 1, error: null },
      { data: [], count: 0, error: null },
    ])
    expect((await getJobQueueStats(db))[1].oldestIso).toBe('2026-08-02T08:00:00.000Z')
  })
})

describe('formatElapsed', () => {
  const now = Date.parse('2026-08-02T12:00:00.000Z')

  it.each([
    ['2026-08-02T11:59:30.000Z', '1分未満'],
    ['2026-08-02T11:45:00.000Z', '15分'],
    ['2026-08-02T09:46:00.000Z', '2時間14分'],
    ['2026-08-02T09:00:00.000Z', '3時間'],
    ['2026-08-01T09:00:00.000Z', '1日3時間'],
    ['2026-07-31T12:00:00.000Z', '2日'],
  ])('%s → %s', (iso, expected) => {
    expect(formatElapsed(iso, now)).toBe(expected)
  })

  it('null・不正値は「—」', () => {
    expect(formatElapsed(null, now)).toBe('—')
    expect(formatElapsed('not-a-date', now)).toBe('—')
  })

  it('未来時刻でもマイナス表示にしない', () => {
    expect(formatElapsed('2026-08-02T12:30:00.000Z', now)).toBe('1分未満')
  })
})
