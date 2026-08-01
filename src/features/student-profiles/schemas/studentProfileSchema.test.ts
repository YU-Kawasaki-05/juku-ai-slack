/** @file
 * 検証: 生徒プロフィール入力の正規化・文字数上限・試験期間の相互検証
 * @verifies FR-09, AC-09-01, DEC-18
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { studentProfileSchema, parseExamSubjects } from './studentProfileSchema'

const PERSON_ID = '11111111-1111-4111-8111-111111111111'

function input(over: Record<string, unknown> = {}) {
  return {
    personId: PERSON_ID,
    summary: '',
    learningStyle: '',
    strengths: '',
    weaknesses: '',
    instructionNotes: '',
    examMode: false,
    examEndDate: '',
    examSubjects: '',
    ...over,
  }
}

/** superRefine が「今日（JST）」を見るため時刻を固定する */
function freezeJst(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

afterEach(() => vi.useRealTimers())

describe('studentProfileSchema（テキスト項目）', () => {
  it('空文字は null に正規化する（列を NULL に戻せる）', () => {
    const r = studentProfileSchema.safeParse(input())
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.summary).toBeNull()
      expect(r.data.learningStyle).toBeNull()
      expect(r.data.strengths).toBeNull()
      expect(r.data.weaknesses).toBeNull()
      expect(r.data.instructionNotes).toBeNull()
      expect(r.data.examModeUntil).toBeNull()
      expect(r.data.examSubjects).toBeNull()
    }
  })

  it('前後の空白を落とす', () => {
    const r = studentProfileSchema.safeParse(input({ summary: '  文章題が苦手  ' }))
    expect(r.success && r.data.summary).toBe('文章題が苦手')
  })

  it('FR-09 の上限を超えたらフィールドエラー', () => {
    const r = studentProfileSchema.safeParse(
      input({ summary: 'あ'.repeat(2001), learningStyle: 'い'.repeat(501) }),
    )
    expect(r.success).toBe(false)
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('summary')
      expect(paths).toContain('learningStyle')
    }
  })

  it('上限ちょうどは通す', () => {
    expect(studentProfileSchema.safeParse(input({ summary: 'あ'.repeat(2000) })).success).toBe(true)
    expect(
      studentProfileSchema.safeParse(input({ instructionNotes: 'あ'.repeat(1000) })).success,
    ).toBe(true)
  })

  it('personId が UUID でなければ弾く', () => {
    expect(studentProfileSchema.safeParse(input({ personId: 'not-uuid' })).success).toBe(false)
  })
})

describe('studentProfileSchema（試験期間）', () => {
  it('ON + 未来日 → exam_mode_until をその日の 24:00 JST にする', () => {
    freezeJst('2026-08-02T00:00:00Z')
    const r = studentProfileSchema.safeParse(input({ examMode: true, examEndDate: '2026-08-10' }))
    expect(r.success && r.data.examModeUntil).toBe('2026-08-10T15:00:00.000Z')
  })

  it('ON なのに最終日が空ならフィールドエラー', () => {
    freezeJst('2026-08-02T00:00:00Z')
    const r = studentProfileSchema.safeParse(input({ examMode: true, examEndDate: '' }))
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].path).toEqual(['examEndDate'])
  })

  it('ON + 過去日は弾く（保存できても効かない設定を作らせない）', () => {
    freezeJst('2026-08-02T00:00:00Z')
    const r = studentProfileSchema.safeParse(input({ examMode: true, examEndDate: '2026-07-01' }))
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toContain('今日以降')
  })

  it('ON + 今日は通す（当日いっぱい有効）', () => {
    freezeJst('2026-08-02T00:00:00Z')
    expect(
      studentProfileSchema.safeParse(input({ examMode: true, examEndDate: '2026-08-02' })).success,
    ).toBe(true)
  })

  it('OFF なら日付が残っていても exam_mode_until は null に戻す', () => {
    freezeJst('2026-08-02T00:00:00Z')
    const r = studentProfileSchema.safeParse(input({ examMode: false, examEndDate: '2026-08-10' }))
    expect(r.success && r.data.examModeUntil).toBeNull()
  })
})

describe('parseExamSubjects', () => {
  it('半角/全角カンマ区切りを配列にし、空要素を落とす', () => {
    expect(parseExamSubjects('数学, 英語、 理科 ,')).toEqual(['数学', '英語', '理科'])
  })

  it('空なら null', () => {
    expect(parseExamSubjects('')).toBeNull()
    expect(parseExamSubjects('  ,  ')).toBeNull()
    expect(parseExamSubjects(null)).toBeNull()
  })

  it('件数・1件あたりの長さの上限を超えたらフィールドエラー', () => {
    const many = studentProfileSchema.safeParse(
      input({ examSubjects: Array.from({ length: 21 }, (_, i) => `科目${i}`).join(',') }),
    )
    expect(many.success).toBe(false)
    if (!many.success) expect(many.error.issues[0].path).toEqual(['examSubjects'])

    const long = studentProfileSchema.safeParse(input({ examSubjects: 'あ'.repeat(51) }))
    expect(long.success).toBe(false)
  })
})
