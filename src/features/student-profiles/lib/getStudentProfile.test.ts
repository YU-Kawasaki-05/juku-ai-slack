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

  it('試験期間中は試験科目もプロンプトに載せる（DEC-18）', async () => {
    const db = createMockDb({
      maybeSingle: {
        data: {
          summary: 'x',
          exam_mode_until: '2026-07-10T00:00:00Z',
          exam_subjects: ['数学', '英語'],
        },
        error: null,
      },
    })
    expect((await getStudentProfile(db, 'p1', NOW)).profileText).toContain('直近の試験科目: 数学、英語')
  })

  it('試験期間外なら試験科目は載せない（今この科目の試験があると誤解させない）', async () => {
    const db = createMockDb({
      maybeSingle: {
        data: { summary: 'x', exam_mode_until: null, exam_subjects: ['数学'] },
        error: null,
      },
    })
    expect((await getStudentProfile(db, 'p1', NOW)).profileText).not.toContain('試験科目')
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

// --- 学年（persons.grade）と PII の取り扱い ---
// createMockDb の maybeSingle は配列を渡すと呼び出し順に消費される。
// getStudentProfile は student_profiles → persons の順に投げるので [プロフィール行, persons行] で渡す
describe('getStudentProfile（学年と PII）', () => {
  it('学年があれば profileText の先頭に載せる', async () => {
    const db = createMockDb({
      maybeSingle: [
        { data: { summary: 'まとめ', exam_mode_until: null }, error: null },
        { data: { grade: '中学3年' }, error: null },
      ],
    })
    const r = await getStudentProfile(db, 'p1', NOW)
    expect(r.profileText?.split('\n')[0]).toBe('学年: 中学3年')
    expect(r.profileText).toContain('要約: まとめ')
    // persons は id でフィルタする（他生徒の学年を混ぜない）
    expect(db.__calls.eq).toContainEqual(['id', 'p1'])
  })

  it('学年が null なら学年の行そのものを出さない（「未設定」と書かない）', async () => {
    const db = createMockDb({
      maybeSingle: [
        { data: { summary: 'まとめ', exam_mode_until: null }, error: null },
        { data: { grade: null }, error: null },
      ],
    })
    const r = await getStudentProfile(db, 'p1', NOW)
    expect(r.profileText).toBe('要約: まとめ')
    expect(r.profileText).not.toContain('学年')
    expect(r.profileText).not.toContain('未設定')
  })

  it('学年が空白のみでも学年の行を出さない', async () => {
    const db = createMockDb({
      maybeSingle: [
        { data: { summary: 'まとめ', exam_mode_until: null }, error: null },
        { data: { grade: '   ' }, error: null },
      ],
    })
    expect((await getStudentProfile(db, 'p1', NOW)).profileText).not.toContain('学年')
  })

  it('プロフィール未登録でも学年だけは載せる', async () => {
    const db = createMockDb({
      maybeSingle: [
        { data: null, error: null },
        { data: { grade: '高校2年' }, error: null },
      ],
    })
    const r = await getStudentProfile(db, 'p1', NOW)
    expect(r.profileText).toBe('学年: 高校2年')
    expect(r.examMode).toBe(false)
  })

  it('氏名は select しない — persons から取得するのは grade のみ', async () => {
    const db = createMockDb({
      maybeSingle: [
        { data: { summary: 'まとめ', exam_mode_until: null }, error: null },
        { data: { grade: '中学3年' }, error: null },
      ],
    })
    await getStudentProfile(db, 'p1', NOW)
    const selects = db.__builder.select.mock.calls.flat()
    expect(selects).toContain('grade')
    for (const arg of selects) {
      expect(String(arg)).not.toContain('name')
      expect(String(arg)).not.toBe('*')
    }
  })

  it('persons 行に氏名が入っていても profileText には決して出さない', async () => {
    const db = createMockDb({
      maybeSingle: [
        { data: { summary: 'まとめ', exam_mode_until: null }, error: null },
        { data: { grade: '中学3年', name: '山田太郎', display_name: 'たろう' }, error: null },
      ],
    })
    const r = await getStudentProfile(db, 'p1', NOW)
    expect(r.profileText).not.toContain('山田太郎')
    expect(r.profileText).not.toContain('たろう')
    // 生徒 ID（UUID）もプロンプトには載せない
    expect(r.profileText).not.toContain('p1')
  })

  it('persons クエリのエラーは上位に伝播する', async () => {
    const db = createMockDb({
      maybeSingle: [
        { data: { summary: 'まとめ', exam_mode_until: null }, error: null },
        { data: null, error: new Error('persons boom') },
      ],
    })
    await expect(getStudentProfile(db, 'p1', NOW)).rejects.toThrow('persons boom')
  })
})
