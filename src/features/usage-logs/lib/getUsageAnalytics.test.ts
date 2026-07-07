/** @file
 * 検証: 利用状況の集計（JST 日別・モデル別・生徒別・エラーコード別）
 * @verifies FR-18
 */
import { describe, it, expect } from 'vitest'
import { aggregateUsage, type ErrorRow, type UsageRow } from './getUsageAnalytics'

const now = new Date('2026-07-08T03:00:00Z') // JST 2026-07-08 12:00

function usage(partial: Partial<UsageRow>): UsageRow {
  return {
    person_id: 'p1',
    model: 'deepseek-chat',
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    estimated_cost: 0.01,
    has_image: false,
    created_at: '2026-07-08T03:00:00Z',
    persons: { name: '山田太郎' },
    ...partial,
  }
}

describe('aggregateUsage', () => {
  it('サマリー合計を集計する', () => {
    const r = aggregateUsage(
      [
        usage({ estimated_cost: 0.02, total_tokens: 200, input_tokens: 120, output_tokens: 80, has_image: true }),
        usage({ estimated_cost: 0.03, total_tokens: 300, input_tokens: 200, output_tokens: 100 }),
      ],
      [],
      30,
      now,
    )
    expect(r.totals.questionCount).toBe(2)
    expect(r.totals.costUsd).toBeCloseTo(0.05)
    expect(r.totals.totalTokens).toBe(500)
    expect(r.totals.inputTokens).toBe(320)
    expect(r.totals.outputTokens).toBe(180)
    expect(r.totals.imageCount).toBe(1)
  })

  it('日別は期間の全日を 0 埋めで昇順に並べ、JST 日付でグループする', () => {
    const r = aggregateUsage([usage({})], [], 7, now)
    expect(r.daily).toHaveLength(7)
    // 昇順・末尾が今日（JST 7/8）
    expect(r.daily[6].date).toBe('2026-07-08')
    expect(r.daily[6].label).toBe('7/8')
    expect(r.daily[6].count).toBe(1)
    // 0 埋めの日
    expect(r.daily[0].count).toBe(0)
  })

  it('UTC 深夜でも JST の日付でグループする', () => {
    // 2026-07-07 23:00 UTC = 2026-07-08 08:00 JST → 7/8 に入る
    const r = aggregateUsage([usage({ created_at: '2026-07-07T23:00:00Z' })], [], 7, now)
    const jul8 = r.daily.find((d) => d.date === '2026-07-08')
    expect(jul8?.count).toBe(1)
  })

  it('モデル別・生徒別を多い順に集計する', () => {
    const r = aggregateUsage(
      [
        usage({ model: 'gpt-4o', persons: { name: '佐藤' } }),
        usage({ model: 'deepseek-chat', persons: { name: '山田' } }),
        usage({ model: 'deepseek-chat', persons: { name: '山田' } }),
      ],
      [],
      30,
      now,
    )
    expect(r.byModel[0]).toMatchObject({ model: 'deepseek-chat', count: 2 })
    expect(r.byModel[1]).toMatchObject({ model: 'gpt-4o', count: 1 })
    expect(r.byPerson[0]).toEqual({ name: '山田', count: 2 })
  })

  it('生徒名が無い行は「（不明）」に集約する', () => {
    const r = aggregateUsage([usage({ persons: null })], [], 30, now)
    expect(r.byPerson[0]).toEqual({ name: '（不明）', count: 1 })
  })

  it('エラーコード別集計とレートリミット件数を出す', () => {
    const errors: ErrorRow[] = [
      { error_code: 'AI_RATE_LIMITED', created_at: '2026-07-08T03:00:00Z' },
      { error_code: 'AI_RATE_LIMITED', created_at: '2026-07-08T04:00:00Z' },
      { error_code: 'AI_TIMEOUT', created_at: '2026-07-08T05:00:00Z' },
    ]
    const r = aggregateUsage([], errors, 30, now)
    expect(r.errorsByCode[0]).toEqual({ code: 'AI_RATE_LIMITED', count: 2 })
    expect(r.rateLimitCount).toBe(2)
  })

  it('生徒別は上位 10 件に絞る', () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      usage({ persons: { name: `生徒${i}` } }),
    )
    const r = aggregateUsage(rows, [], 30, now)
    expect(r.byPerson).toHaveLength(10)
  })
})
