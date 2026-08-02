/** @file
 * 検証: 重複イベント検出（event_id の unique 制約）と処理状態の確定
 * @verifies AC-01-04, A-2
 */
import { describe, it, expect } from 'vitest'
import { recordEventReceipt, markReceiptStatus } from './eventReceipts'
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

describe('markReceiptStatus（A-2: ACK 後の結果を receipt に残す）', () => {
  it('status と processed_at を event_id 指定で更新する', async () => {
    const db = createMockDb({ thenable: { error: null } })
    await markReceiptStatus(db, 'Ev1', 'processed', '2026-08-02T00:00:00.000Z')
    expect(db.__calls.from).toContain('slack_event_receipts')
    expect(db.__calls.update[0]).toEqual({
      status: 'processed',
      processed_at: '2026-08-02T00:00:00.000Z',
    })
    expect(db.__calls.eq).toContainEqual(['event_id', 'Ev1'])
  })

  it('失敗した処理は failed として残す（再処理対象の特定に使う）', async () => {
    const db = createMockDb({ thenable: { error: null } })
    await markReceiptStatus(db, 'Ev1', 'failed')
    expect((db.__calls.update[0] as Record<string, unknown>).status).toBe('failed')
  })

  it('更新失敗は主処理を止めない（ベストエフォート）', async () => {
    const db = createMockDb({ thenable: { error: { message: 'boom' } } })
    await expect(markReceiptStatus(db, 'Ev1', 'processed')).resolves.toBeUndefined()
  })
})
