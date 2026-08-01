/** @file
 * 検証: 試験期間の JST 暦日 ↔ TIMESTAMPTZ 変換と有効判定
 * @verifies FR-09, DEC-18, BR-05-08, AC-05-05
 */
import { describe, it, expect } from 'vitest'
import {
  examDateToUntilIso,
  untilIsoToExamDate,
  isExamModeActive,
  jstToday,
  toExamPeriodDefaults,
} from './examPeriod'

describe('examDateToUntilIso', () => {
  it('最終日の 24:00 JST（= 同日 15:00 UTC）を境界にする', () => {
    expect(examDateToUntilIso('2026-08-10')).toBe('2026-08-10T15:00:00.000Z')
  })

  it('最終日の当日 23:59 JST はまだ試験期間中', () => {
    const until = examDateToUntilIso('2026-08-10')
    // 2026-08-10 23:59 JST = 2026-08-10T14:59Z
    expect(isExamModeActive(until, new Date('2026-08-10T14:59:00Z'))).toBe(true)
  })

  it('翌日 00:00 JST を過ぎたら試験期間外', () => {
    const until = examDateToUntilIso('2026-08-10')
    expect(isExamModeActive(until, new Date('2026-08-10T15:00:00Z'))).toBe(false)
  })
})

describe('untilIsoToExamDate', () => {
  it('境界時刻から最終日の暦日に戻す（往復で一致）', () => {
    expect(untilIsoToExamDate(examDateToUntilIso('2026-08-10'))).toBe('2026-08-10')
    expect(untilIsoToExamDate(examDateToUntilIso('2026-01-01'))).toBe('2026-01-01')
    expect(untilIsoToExamDate(examDateToUntilIso('2026-12-31'))).toBe('2026-12-31')
  })
})

describe('isExamModeActive', () => {
  it('未設定は false', () => {
    expect(isExamModeActive(null, new Date('2026-08-01T00:00:00Z'))).toBe(false)
    expect(isExamModeActive(undefined, new Date('2026-08-01T00:00:00Z'))).toBe(false)
  })
})

describe('jstToday', () => {
  it('UTC の日付ではなく JST の暦日を返す（UTC 深夜の日跨ぎ）', () => {
    // 2026-08-09 16:00 UTC = 2026-08-10 01:00 JST
    expect(jstToday(new Date('2026-08-09T16:00:00Z'))).toBe('2026-08-10')
  })
})

describe('toExamPeriodDefaults', () => {
  const now = new Date('2026-08-02T00:00:00Z')

  it('有効期間中はチェック ON + 最終日を復元する', () => {
    expect(toExamPeriodDefaults(examDateToUntilIso('2026-08-10'), now)).toEqual({
      active: true,
      endDate: '2026-08-10',
    })
  })

  it('期限切れの値は復元しない（効いていないのに ON に見せない）', () => {
    expect(toExamPeriodDefaults(examDateToUntilIso('2026-07-01'), now)).toEqual({
      active: false,
      endDate: '',
    })
  })

  it('未設定は OFF', () => {
    expect(toExamPeriodDefaults(null, now)).toEqual({ active: false, endDate: '' })
  })
})
