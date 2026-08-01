/** @file
 * 検証: 管理画面向け student_profiles 読み取り
 * @verifies FR-09, AC-09-01
 */
import { describe, it, expect } from 'vitest'
import { getStudentProfileRow, getExamModePersonIds } from './getStudentProfileRow'
import { createMockDb } from '@/test/mocks/supabaseMock'

describe('getStudentProfileRow', () => {
  it('person_id で1件引く（未登録は null）', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: null } })
    expect(await getStudentProfileRow(db, 'p1')).toBeNull()
    expect(db.__calls.eq).toContainEqual(['person_id', 'p1'])
  })

  it('DB エラーは伝播する', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: { message: 'boom' } } })
    await expect(getStudentProfileRow(db, 'p1')).rejects.toThrow()
  })
})

describe('getExamModePersonIds', () => {
  it('exam_mode_until が現在より未来の person_id だけを返す', async () => {
    const now = new Date('2026-08-02T00:00:00Z')
    const db = createMockDb({
      thenable: { data: [{ person_id: 'p1' }, { person_id: 'p2' }], error: null },
    })
    const ids = await getExamModePersonIds(db, now)
    expect([...ids]).toEqual(['p1', 'p2'])
    // 絞り込みは DB 側（一覧の件数ぶん取ってこない）
    expect(db.__calls.gt).toContainEqual(['exam_mode_until', now.toISOString()])
  })

  it('該当なしは空集合', async () => {
    const db = createMockDb({ thenable: { data: [], error: null } })
    expect((await getExamModePersonIds(db)).size).toBe(0)
  })
})
