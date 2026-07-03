/** @file
 * 検証: jobs テーブルへのジョブ登録（status=pending）
 * @verifies AC-04-01
 */
import { describe, it, expect } from 'vitest'
import { enqueueJob } from './enqueueJob'
import { createMockDb } from '@/test/mocks/supabaseMock'
import { JOB_TYPE_PROCESS_MESSAGE, DEFAULT_MAX_ATTEMPTS } from '@shared/lib/constants'
import type { ProcessSlackMessagePayload } from '../types'

const payload: ProcessSlackMessagePayload = {
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

describe('enqueueJob', () => {
  it('status=pending の process_slack_message ジョブを登録し id を返す（AC-04-01）', async () => {
    const db = createMockDb({ single: { data: { id: 'job1' }, error: null } })
    const id = await enqueueJob(db, payload)
    expect(id).toBe('job1')

    const inserted = db.__calls.insert[0] as Record<string, unknown>
    expect(inserted.job_type).toBe(JOB_TYPE_PROCESS_MESSAGE)
    expect(inserted.status).toBe('pending')
    expect(inserted.max_attempts).toBe(DEFAULT_MAX_ATTEMPTS)
    expect(inserted.payload).toEqual(payload)
  })

  it('max_attempts を上書きできる', async () => {
    const db = createMockDb({ single: { data: { id: 'job2' }, error: null } })
    await enqueueJob(db, payload, 5)
    expect((db.__calls.insert[0] as Record<string, unknown>).max_attempts).toBe(5)
  })

  it('DB エラーは伝播する', async () => {
    const db = createMockDb({ single: { data: null, error: { message: 'boom' } } })
    await expect(enqueueJob(db, payload)).rejects.toBeTruthy()
  })
})
