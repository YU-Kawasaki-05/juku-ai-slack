/** @file
 * 検証: channel_id からの紐付け検索と状態判定（生徒の在籍状態を含む）
 * @verifies AC-07-01, AC-07-03, H-6
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
  persons: { status: 'active' },
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

  it('埋め込んだ persons は binding に混ぜない（呼び出し側は binding 列のみ使う）', async () => {
    const db = createMockDb({ maybeSingle: { data: activeRow, error: null } })
    const result = await lookupBinding(db, 'C1')
    expect(result.binding).not.toHaveProperty('persons')
  })

  it('inactive は status=inactive（AC-07-03）', async () => {
    const db = createMockDb({ maybeSingle: { data: { ...activeRow, status: 'inactive' }, error: null } })
    const result = await lookupBinding(db, 'C1')
    expect(result.status).toBe('inactive')
  })

  // --- H-6: 退塾生（persons.status != active）---
  it('生徒が inactive なら person_inactive を返す（binding は active でも, H-6）', async () => {
    const db = createMockDb({
      maybeSingle: { data: { ...activeRow, persons: { status: 'inactive' } }, error: null },
    })
    const result = await lookupBinding(db, 'C1')
    expect(result.status).toBe('person_inactive')
    expect(result.binding?.person_id).toBe('p1')
  })

  it('binding の inactive が person_inactive より優先される（案内文言を返す側, H-6）', async () => {
    const db = createMockDb({
      maybeSingle: {
        data: { ...activeRow, status: 'inactive', persons: { status: 'inactive' } },
        error: null,
      },
    })
    expect((await lookupBinding(db, 'C1')).status).toBe('inactive')
  })

  it('persons が引けなかった場合は従来どおり active（在籍判定でフェイルクローズしない）', async () => {
    const db = createMockDb({ maybeSingle: { data: { ...activeRow, persons: null }, error: null } })
    expect((await lookupBinding(db, 'C1')).status).toBe('active')
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
