/** @file
 * 検証: 月次レポートの対象月（日本時間の前月）・月の境界・日付キー
 * @verifies FR-08
 */
import { describe, it, expect } from 'vitest'
import {
  formatMonthJa,
  getMonthBoundsIso,
  getPreviousReportMonth,
  isReportMonth,
  jstParts,
  toJstDateKey,
  toJstShortStamp,
  toReportMonthDate,
} from './reportMonth'

describe('getPreviousReportMonth（日本時間で判定する）', () => {
  it('日本時間の 9/1 9:00（cron の実行時刻 = 0:00 UTC）は前月の 8 月', () => {
    expect(getPreviousReportMonth(new Date('2026-09-01T00:00:00Z'))).toBe('2026-08')
  })

  it('日本時間の月初 0:00 ちょうどから新しい月として扱う（UTC ではまだ前月末）', () => {
    // 2026-09-30T15:00:00Z = 2026-10-01 00:00 JST
    expect(getPreviousReportMonth(new Date('2026-09-30T15:00:00Z'))).toBe('2026-09')
    // その 1 ミリ秒前は 9/30 23:59:59.999 JST → 前月は 8 月
    expect(getPreviousReportMonth(new Date('2026-09-30T14:59:59.999Z'))).toBe('2026-08')
  })

  it('年またぎ: 日本時間の 1 月は前年 12 月', () => {
    expect(getPreviousReportMonth(new Date('2027-01-01T00:00:00Z'))).toBe('2026-12')
    // UTC ではまだ 12/31 だが、日本時間では 2027-01-01 00:30
    expect(getPreviousReportMonth(new Date('2026-12-31T15:30:00Z'))).toBe('2026-12')
  })

  it('月の途中でも前月を返す（手動ボタンはいつ押しても前月が対象）', () => {
    expect(getPreviousReportMonth(new Date('2026-03-15T03:00:00Z'))).toBe('2026-02')
  })
})

describe('jstParts', () => {
  it('UTC の 0:00 は日本時間の同じ日の 9 時', () => {
    expect(jstParts(new Date('2026-09-03T00:00:00Z'))).toEqual({ year: 2026, month: 9, day: 3 })
  })
  it('UTC の 15:00 以降は日本時間では翌日', () => {
    expect(jstParts(new Date('2026-09-02T15:00:00Z'))).toEqual({ year: 2026, month: 9, day: 3 })
  })
})

describe('getMonthBoundsIso', () => {
  it('日本時間の月初 0:00 〜 翌月初 0:00 を UTC で返す', () => {
    expect(getMonthBoundsIso('2026-09')).toEqual({
      startIso: '2026-08-31T15:00:00.000Z',
      endIso: '2026-09-30T15:00:00.000Z',
    })
  })
  it('12 月は翌年 1 月初までになる', () => {
    expect(getMonthBoundsIso('2026-12')).toEqual({
      startIso: '2026-11-30T15:00:00.000Z',
      endIso: '2026-12-31T15:00:00.000Z',
    })
  })
  it('不正な月は例外', () => {
    expect(() => getMonthBoundsIso('2026-13')).toThrow()
    expect(() => getMonthBoundsIso('2026-9')).toThrow()
  })
})

describe('その他の整形', () => {
  it('toReportMonthDate は月初日', () => {
    expect(toReportMonthDate('2026-09')).toBe('2026-09-01')
  })
  it('isReportMonth', () => {
    expect(isReportMonth('2026-09')).toBe(true)
    expect(isReportMonth('2026-00')).toBe(false)
    expect(isReportMonth('202609')).toBe(false)
  })
  it('toJstDateKey は日本時間の日付', () => {
    expect(toJstDateKey('2026-09-10T15:30:00Z')).toBe('2026-09-11')
  })
  it('toJstShortStamp', () => {
    expect(toJstShortStamp('2026-09-10T03:05:00Z')).toBe('09/10 12:05')
  })
  it('formatMonthJa', () => {
    expect(formatMonthJa('2026-09')).toBe('2026年9月')
    expect(formatMonthJa('2026-12')).toBe('2026年12月')
  })
})
