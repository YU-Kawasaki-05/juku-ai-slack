/** @file
 * 検証: channel_id からの紐付け検索と状態判定
 * @verifies AC-07-01, AC-07-03
 */
import { describe, it, expect } from 'vitest'
import { lookupBinding } from './lookupBinding'
import { createMockDb } from '@/test/mocks/supabaseMock'

const activeRow = {
  id: 'b1',
  slack_channel_id: 'C1',
  person_id: 'p1',
  default_report_id: 'r1',
  status: 'active',
}

describe('lookupBinding', () => {
  it('active な紐付けを返す（AC-07-01）', async () => {
    const db = createMockDb({ maybeSingle: { data: activeRow, error: null } })
    const result = await lookupBinding(db, 'C1')
    expect(result.status).toBe('active')
    expect(result.binding?.person_id).toBe('p1')
    // BR-07-01: channel_id を信頼の基点にする（channel_name では引かない）
    expect(db.__calls.eq).toContainEqual(['slack_channel_id', 'C1'])
    expect(db.__calls.eq.some(([col]) => col === 'slack_channel_name')).toBe(false)
  })

  it('inactive は status=inactive（AC-07-03）', async () => {
    const db = createMockDb({ maybeSingle: { data: { ...activeRow, status: 'inactive' }, error: null } })
    const result = await lookupBinding(db, 'C1')
    expect(result.status).toBe('inactive')
  })

  it('紐付けなしは status=none, binding=null', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: null } })
    const result = await lookupBinding(db, 'C_unknown')
    expect(result.status).toBe('none')
    expect(result.binding).toBeNull()
  })

  it('DB エラーは伝播する', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: { message: 'boom' } } })
    await expect(lookupBinding(db, 'C1')).rejects.toBeTruthy()
  })
})
