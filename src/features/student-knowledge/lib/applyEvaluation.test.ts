/** @file
 * 検証: Evaluation の BKT 反映（skip凍結・低確信度・unknown・正誤更新）
 * @verifies AC-23-01, AC-23-02, AC-23-03, AC-23-07, BR-23-01, BR-23-02
 */
import { describe, it, expect } from 'vitest'
import { applyEvaluation } from './applyEvaluation'
import { createMockDb } from '@/test/mocks/supabaseMock'
import type { Evaluation } from './evaluationSchema'

function ev(over: Partial<Evaluation> = {}): Evaluation {
  return {
    reasoning: 'r',
    signal: 'correct',
    identified_misconception: null,
    topic_id: '二次方程式',
    subject: '数学',
    confidence: 0.9,
    ...over,
  }
}

describe('applyEvaluation', () => {
  it('skip は BKT を据え置き、DB を触らない（AC-23-03, BR-23-02）', async () => {
    const db = createMockDb({})
    const r = await applyEvaluation(db, 'p1', ev({ signal: 'skip' }))
    expect(r).toEqual({ updated: false, reason: 'skip' })
    expect(db.__calls.from.length).toBe(0)
  })

  it('topic_id=unknown はスキップ', async () => {
    const db = createMockDb({})
    const r = await applyEvaluation(db, 'p1', ev({ topic_id: 'unknown' }))
    expect(r.updated).toBe(false)
    expect(r.reason).toBe('unknown_topic')
    expect(db.__calls.from.length).toBe(0)
  })

  it('confidence<0.5 は書き込まない（AC-23-07）', async () => {
    const db = createMockDb({})
    const r = await applyEvaluation(db, 'p1', ev({ confidence: 0.4 }))
    expect(r.updated).toBe(false)
    expect(r.reason).toBe('low_confidence')
    expect(db.__calls.from.length).toBe(0)
  })

  it('correct で p_mastery が上昇し UPSERT する（AC-23-01）', async () => {
    const db = createMockDb({ maybeSingle: { data: { p_mastery: 0.45, attempt_count: 2, consecutive_correct: 1, last_seen_at: null }, error: null } })
    const r = await applyEvaluation(db, 'p1', ev({ signal: 'correct' }))
    expect(r.updated).toBe(true)
    expect(r.newPMastery!).toBeGreaterThan(0.45)
    const row = db.__calls.upsert[0] as Record<string, unknown>
    expect(row.person_id).toBe('p1')
    expect(row.topic).toBe('二次方程式')
    expect(row.attempt_count).toBe(3)
    expect(row.consecutive_correct).toBe(2)
    expect(db.__calls.upsertOptions[0]).toEqual({ onConflict: 'person_id,topic' })
  })

  it('incorrect で p_mastery が低下し、連続正解が 0 にリセット（AC-23-02）', async () => {
    const db = createMockDb({ maybeSingle: { data: { p_mastery: 0.6, attempt_count: 4, consecutive_correct: 3, last_seen_at: null }, error: null } })
    const r = await applyEvaluation(db, 'p1', ev({ signal: 'incorrect' }))
    expect(r.newPMastery!).toBeLessThan(0.6)
    const row = db.__calls.upsert[0] as Record<string, unknown>
    expect(row.consecutive_correct).toBe(0)
  })

  it('partial は誤答として扱う（BR-23-01）', async () => {
    const db = createMockDb({ maybeSingle: { data: { p_mastery: 0.6, attempt_count: 1, consecutive_correct: 0, last_seen_at: null }, error: null } })
    const r = await applyEvaluation(db, 'p1', ev({ signal: 'partial' }))
    expect(r.newPMastery!).toBeLessThan(0.6)
  })

  it('レコードなしはデフォルト P(0.2) から更新', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: null } })
    const r = await applyEvaluation(db, 'p1', ev({ signal: 'correct' }))
    expect(r.updated).toBe(true)
    const row = db.__calls.upsert[0] as Record<string, unknown>
    expect(row.attempt_count).toBe(1)
    expect(row.consecutive_correct).toBe(1)
  })
})
