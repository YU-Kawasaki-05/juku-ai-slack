/** @file
 * 検証: 生徒一覧の status フィルタ（既定は active のみ）
 * @verifies FR-14, AC-14-01, H-6
 */
import { describe, it, expect } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'
import { getPersons, countActivePersons } from './getPersons'

describe('getPersons', () => {
  it('既定では active のみに絞る（無効な生徒はプルダウン・集計に出さない）', async () => {
    const db = createMockDb({ thenable: { data: [], error: null } })
    await getPersons(db)
    expect(db.__calls.eq).toEqual([['status', 'active']])
  })

  it('includeInactive:true なら status で絞らない（生徒一覧画面向け）', async () => {
    const db = createMockDb({ thenable: { data: [], error: null } })
    await getPersons(db, { includeInactive: true })
    expect(db.__calls.eq).toEqual([])
  })

  it('DB エラーは文脈付きで throw する', async () => {
    const db = createMockDb({ thenable: { data: null, error: { message: 'boom' } } })
    await expect(getPersons(db)).rejects.toThrow(/getPersons/)
  })
})

describe('countActivePersons', () => {
  it('active のみを count で数える（全件取得しない）', async () => {
    const db = createMockDb({ thenable: { count: 7, error: null } })
    expect(await countActivePersons(db)).toBe(7)
    expect(db.__calls.eq).toEqual([['status', 'active']])
  })
})
