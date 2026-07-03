/** @file
 * 検証: 重複イベント検出（event_id の unique 制約）
 * @verifies AC-01-04
 */
import { describe, it, expect } from 'vitest'
import { recordEventReceipt } from './eventReceipts'
import { createMockDb } from '@/test/mocks/supabaseMock'

const params = { eventId: 'Ev1', teamId: 'T1', eventType: 'message', eventTs: '100.1' }

describe('recordEventReceipt', () => {
  it('新規なら new', async () => {
    const db = createMockDb({ thenable: { error: null } })
    expect(await recordEventReceipt(db, params)).toBe('new')
  })

  it('unique 制約違反(23505) なら duplicate（AC-01-04）', async () => {
    const db = createMockDb({ thenable: { error: { code: '23505', message: 'dup' } } })
    expect(await recordEventReceipt(db, params)).toBe('duplicate')
  })

  it('その他の DB エラーは伝播する', async () => {
    const db = createMockDb({ thenable: { error: { code: '55555', message: 'boom' } } })
    await expect(recordEventReceipt(db, params)).rejects.toBeTruthy()
  })
})
