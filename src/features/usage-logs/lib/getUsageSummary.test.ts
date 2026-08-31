/** @file
 * 検証: JST 基準の「今日」「今月」境界計算と、サマリーの DB 集計移行
 * @verifies FR-18（SCR-02 サマリーカード）, E-4
 */
import { describe, it, expect } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'
import { jstDayStartIso, jstMonthStartIso, getUsageSummary } from './getUsageSummary'

describe('jstDayStartIso', () => {
  it('JST 深夜 0:30（UTC 前日 15:30）は JST 当日 0:00 = UTC 前日 15:00', () => {
    // 2026-07-07 00:30 JST = 2026-07-06 15:30 UTC
    const now = new Date('2026-07-06T15:30:00Z')
    expect(jstDayStartIso(now)).toBe('2026-07-06T15:00:00.000Z')
  })

  it('JST 昼（UTC 午前）は同じ JST 日の 0:00', () => {
    // 2026-07-07 12:00 JST = 2026-07-07 03:00 UTC
    const now = new Date('2026-07-07T03:00:00Z')
    expect(jstDayStartIso(now)).toBe('2026-07-06T15:00:00.000Z')
  })
})

describe('jstMonthStartIso', () => {
  it('JST 月初深夜（UTC 前月末）は JST 当月1日 0:00', () => {
    // 2026-07-01 00:30 JST = 2026-06-30 15:30 UTC → 月初は 2026-06-30 15:00 UTC
    const now = new Date('2026-06-30T15:30:00Z')
    expect(jstMonthStartIso(now)).toBe('2026-06-30T15:00:00.000Z')
  })

  it('UTC ではまだ前月の時刻でも JST の月で判定する', () => {
    // 2026-06-30 23:00 UTC = 2026-07-01 08:00 JST → 7月扱い
    const now = new Date('2026-06-30T23:00:00Z')
    expect(jstMonthStartIso(now)).toBe('2026-06-30T15:00:00.000Z')
  })
})

describe('getUsageSummary', () => {
  const now = new Date('2026-07-08T03:00:00Z')

  it('当月行を全件取得せず RPC の SUM/COUNT を使う（1000行上限の回避）', async () => {
    const db = createMockDb({
      rpc: {
        admin_usage_summary: {
          data: [{ today_question_count: 42, month_cost_usd: 12.34 }],
          error: null,
        },
      },
    })
    const r = await getUsageSummary(db, now)
    expect(db.__calls.rpc).toEqual([
      [
        'admin_usage_summary',
        { p_day_start: '2026-07-07T15:00:00.000Z', p_month_start: '2026-06-30T15:00:00.000Z' },
      ],
    ])
    expect(db.__calls.from).toHaveLength(0)
    expect(r).toEqual({ todayQuestionCount: 42, monthCostUsd: 12.34 })
  })

  it('結果が空でも 0 を返す', async () => {
    const db = createMockDb({ rpc: { admin_usage_summary: { data: [], error: null } } })
    expect(await getUsageSummary(db, now)).toEqual({ todayQuestionCount: 0, monthCostUsd: 0 })
  })

  it('RPC エラーは文脈付きで throw する', async () => {
    const db = createMockDb({
      rpc: { admin_usage_summary: { data: null, error: { message: 'boom' } } },
    })
    await expect(getUsageSummary(db, now)).rejects.toThrow(/getUsageSummary/)
  })
})
