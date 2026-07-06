/** @file
 * 検証: BKT 更新式と忘却減衰
 * @verifies AC-23-01, AC-23-02
 */
import { describe, it, expect } from 'vitest'
import { updateBKT, applyForgettingDecay } from './bkt'

describe('updateBKT', () => {
  it('正答で p_mastery が上昇する（AC-23-01）', () => {
    const before = 0.45
    const after = updateBKT(before, true)
    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThanOrEqual(1)
  })

  it('誤答で p_mastery が低下する（AC-23-02）', () => {
    const before = 0.6
    const after = updateBKT(before, false)
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThanOrEqual(0)
  })

  it('連続正答で単調に上昇し 1 に漸近する', () => {
    let p = 0.2
    for (let i = 0; i < 10; i++) {
      const next = updateBKT(p, true)
      expect(next).toBeGreaterThan(p)
      p = next
    }
    expect(p).toBeGreaterThan(0.9)
  })

  it('学習率 P(T) により誤答でも 0 には落ちきらない', () => {
    const after = updateBKT(0.01, false)
    expect(after).toBeGreaterThan(0)
  })
})

describe('applyForgettingDecay', () => {
  it('経過 0 日なら変化なし', () => {
    expect(applyForgettingDecay(0.8, 0)).toBeCloseTo(0.8, 10)
  })
  it('1週間で約1%減衰', () => {
    expect(applyForgettingDecay(1.0, 7)).toBeCloseTo(0.99, 4)
  })
  it('経過が長いほど減衰が大きい（単調減少）', () => {
    expect(applyForgettingDecay(1.0, 28)).toBeLessThan(applyForgettingDecay(1.0, 7))
  })
})
