/** @file
 * 検証: 利用状況の集計（DB 集計結果の整形。JST 日別・モデル別・生徒別・エラーコード別）
 * @verifies FR-18, E-4, G-7
 */
import { describe, it, expect } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'
import {
  buildAnalytics,
  getUsageAnalytics,
  UNKNOWN_PERSON_LABEL,
  type UsageAnalyticsRaw,
} from './getUsageAnalytics'

const now = new Date('2026-07-08T03:00:00Z') // JST 2026-07-08 12:00

function raw(partial: Partial<UsageAnalyticsRaw> = {}): UsageAnalyticsRaw {
  return {
    totals: {
      question_count: 0,
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      image_count: 0,
    },
    daily: [],
    by_model: [],
    by_person: [],
    errors_by_code: [],
    ...partial,
  }
}

describe('buildAnalytics', () => {
  it('DB が返した合計をそのまま採用する（JS 側で再集計しない）', () => {
    const r = buildAnalytics(
      raw({
        totals: {
          question_count: 2,
          cost_usd: 0.05,
          input_tokens: 320,
          output_tokens: 180,
          total_tokens: 500,
          image_count: 1,
        },
      }),
      30,
      now,
    )
    expect(r.totals).toEqual({
      questionCount: 2,
      costUsd: 0.05,
      inputTokens: 320,
      outputTokens: 180,
      totalTokens: 500,
      imageCount: 1,
    })
  })

  it('日別は期間の全日を 0 埋めで昇順に並べる', () => {
    const r = buildAnalytics(
      raw({ daily: [{ date: '2026-07-08', count: 1, cost_usd: 0.01, tokens: 150 }] }),
      7,
      now,
    )
    expect(r.daily).toHaveLength(7)
    expect(r.daily[6]).toMatchObject({ date: '2026-07-08', label: '7/8', count: 1, tokens: 150 })
    expect(r.daily[0].count).toBe(0)
  })

  it('期間外の日付は日別に加算しない', () => {
    const r = buildAnalytics(
      raw({ daily: [{ date: '2020-01-01', count: 9, cost_usd: 1, tokens: 9 }] }),
      7,
      now,
    )
    expect(r.daily.reduce((s, d) => s + d.count, 0)).toBe(0)
  })

  it('モデル別を多い順に並べる', () => {
    const r = buildAnalytics(
      raw({
        by_model: [
          { model: 'gpt-4o', count: 1, cost_usd: 0.01 },
          { model: 'deepseek-chat', count: 2, cost_usd: 0.02 },
        ],
      }),
      30,
      now,
    )
    expect(r.byModel[0]).toEqual({ model: 'deepseek-chat', count: 2, costUsd: 0.02 })
    expect(r.byModel[1]).toEqual({ model: 'gpt-4o', count: 1, costUsd: 0.01 })
  })

  it('G-7: 同姓同名でも person_id が違えば別行のまま合算されない', () => {
    const r = buildAnalytics(
      raw({
        by_person: [
          { person_id: 'p1', name: '山田', count: 3 },
          { person_id: 'p2', name: '山田', count: 5 },
        ],
      }),
      30,
      now,
    )
    expect(r.byPerson).toEqual([
      { personId: 'p2', name: '山田', count: 5 },
      { personId: 'p1', name: '山田', count: 3 },
    ])
  })

  it('生徒名が解決できない行は「（不明）」で表示する', () => {
    const r = buildAnalytics(raw({ by_person: [{ person_id: null, name: null, count: 1 }] }), 30, now)
    expect(r.byPerson[0]).toEqual({ personId: null, name: UNKNOWN_PERSON_LABEL, count: 1 })
  })

  it('生徒別は上位 10 件に絞る', () => {
    const r = buildAnalytics(
      raw({
        by_person: Array.from({ length: 15 }, (_, i) => ({
          person_id: `p${i}`,
          name: `生徒${i}`,
          count: i + 1,
        })),
      }),
      30,
      now,
    )
    expect(r.byPerson).toHaveLength(10)
    expect(r.byPerson[0].count).toBe(15)
  })

  it('エラーコード別集計とレートリミット件数を出す', () => {
    const r = buildAnalytics(
      raw({
        errors_by_code: [
          { code: 'AI_TIMEOUT', count: 1 },
          { code: 'AI_RATE_LIMITED', count: 2 },
        ],
      }),
      30,
      now,
    )
    expect(r.errorsByCode[0]).toEqual({ code: 'AI_RATE_LIMITED', count: 2 })
    expect(r.rateLimitCount).toBe(2)
  })
})

describe('getUsageAnalytics', () => {
  it('行を全件取得せず RPC を1回だけ呼ぶ（1000行上限の回避）', async () => {
    const db = createMockDb({
      rpc: { admin_usage_analytics: { data: raw({ totals: { question_count: 1234, cost_usd: 9.5, input_tokens: 0, output_tokens: 0, total_tokens: 0, image_count: 0 } }), error: null } },
    })
    const r = await getUsageAnalytics(db, 30, now)
    expect(db.__calls.rpc).toEqual([
      // JST 2026-07-08 を含む過去 30 日 → JST 2026-06-09 0:00 = UTC 2026-06-08T15:00Z
      ['admin_usage_analytics', { p_from: '2026-06-08T15:00:00.000Z' }],
    ])
    expect(db.__calls.from).toHaveLength(0)
    expect(r.totals.questionCount).toBe(1234)
  })

  it('RPC エラーは文脈付きで throw する', async () => {
    const db = createMockDb({
      rpc: { admin_usage_analytics: { data: null, error: { message: 'boom' } } },
    })
    await expect(getUsageAnalytics(db, 30, now)).rejects.toThrow(/getUsageAnalytics/)
  })
})
