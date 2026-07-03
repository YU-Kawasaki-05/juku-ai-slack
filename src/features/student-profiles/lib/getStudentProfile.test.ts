/** @file
 * 検証: プロフィール要約の結合と試験前モード判定
 * @verifies FR-09, AC-05-05
 */
import { describe, it, expect } from 'vitest'
import { getStudentProfile } from './getStudentProfile'
import { createMockDb } from '@/test/mocks/supabaseMock'

const NOW = new Date('2026-07-03T00:00:00Z')

describe('getStudentProfile', () => {
  it('非nullフィールドを結合し profileText にする', async () => {
    const db = createMockDb({
      maybeSingle: {
        data: { summary: 'まとめ', weaknesses: '計算ミス', exam_mode_until: null },
        error: null,
      },
    })
    const r = await getStudentProfile(db, 'p1', NOW)
    expect(r.profileText).toContain('まとめ')
    expect(r.profileText).toContain('計算ミス')
    expect(r.examMode).toBe(false)
  })

  it('exam_mode_until が未来なら examMode=true（AC-05-05）', async () => {
    const db = createMockDb({
      maybeSingle: { data: { summary: 'x', exam_mode_until: '2026-07-10T00:00:00Z' }, error: null },
    })
    expect((await getStudentProfile(db, 'p1', NOW)).examMode).toBe(true)
  })

  it('exam_mode_until が過去なら examMode=false', async () => {
    const db = createMockDb({
      maybeSingle: { data: { summary: 'x', exam_mode_until: '2026-06-01T00:00:00Z' }, error: null },
    })
    expect((await getStudentProfile(db, 'p1', NOW)).examMode).toBe(false)
  })

  it('プロフィール無しは profileText=null, examMode=false', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: null } })
    const r = await getStudentProfile(db, 'p1', NOW)
    expect(r.profileText).toBeNull()
    expect(r.examMode).toBe(false)
    // person_id でフィルタしている
    expect(db.__calls.eq).toContainEqual(['person_id', 'p1'])
  })
})
