/** @file
 * 検証: 知識状態サマリー生成と読取時の忘却減衰
 * @verifies AC-23-05, BR-23-05
 */
import { describe, it, expect } from 'vitest'
import { getKnowledgeSummary, decayedMastery } from './knowledgeSummary'
import { createMockDb } from '@/test/mocks/supabaseMock'

const NOW = new Date('2026-07-03T00:00:00Z')

describe('decayedMastery', () => {
  it('last_seen なし or 14日未満は減衰しない', () => {
    expect(decayedMastery(0.8, null, NOW)).toBe(0.8)
    const recent = new Date('2026-06-30T00:00:00Z').toISOString() // 3日前
    expect(decayedMastery(0.8, recent, NOW)).toBe(0.8)
  })
  it('14日以上は減衰する', () => {
    const old = new Date('2026-05-01T00:00:00Z').toISOString() // 約63日前
    expect(decayedMastery(0.8, old, NOW)).toBeLessThan(0.8)
  })
})

describe('getKnowledgeSummary', () => {
  it('科目別にラベル付きでまとめる（AC-23-05）', async () => {
    const db = createMockDb({
      thenable: {
        data: [
          { topic: '二次方程式', subject: '数学', p_mastery: 0.45, attempt_count: 3, last_seen_at: null },
          { topic: '確率', subject: '数学', p_mastery: 0.18, attempt_count: 2, last_seen_at: null },
          { topic: '時制', subject: '英語', p_mastery: 0.97, attempt_count: 5, last_seen_at: null },
        ],
        error: null,
      },
    })
    const summary = await getKnowledgeSummary(db, 'p1', NOW)
    expect(summary).toContain('数学:')
    expect(summary).toContain('二次方程式(習得中:P=0.45,3回)')
    expect(summary).toContain('確率(苦手:P=0.18,2回)')
    expect(summary).toContain('英語:')
    expect(summary).toContain('時制(習得済:P=0.97,5回)')
    // person_id で絞る
    expect(db.__calls.eq).toContainEqual(['person_id', 'p1'])
  })

  it('レコードなしは null', async () => {
    const db = createMockDb({ thenable: { data: [], error: null } })
    expect(await getKnowledgeSummary(db, 'p1', NOW)).toBeNull()
  })
})
