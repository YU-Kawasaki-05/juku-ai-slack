/** @file
 * 検証: BKT 更新式と忘却減衰、吸収状態（p=1.0）の回避
 * @verifies AC-23-01, AC-23-02, G-5
 */
import { describe, it, expect } from 'vitest'
import { updateBKT, applyForgettingDecay, clampMastery } from './bkt'

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

  // --- G-5: 吸収状態の回避 ---
  it('連続正解を重ねても p は 1.0 に到達しない（吸収状態にならない）', () => {
    let p = 0.2
    for (let i = 0; i < 100; i++) p = updateBKT(p, true)
    expect(p).toBeLessThan(1)
  })

  it('連続正解24回のあとでも不正解で p が下がる（G-5 回帰）', () => {
    let p = 0.2
    for (let i = 0; i < 24; i++) p = updateBKT(p, true)
    const beforeMiss = p
    const afterMiss = updateBKT(p, false)
    // 修正前は p が厳密に 1.0 になり、以後どんな不正解でも 1.0 のまま動かなかった
    expect(beforeMiss).toBeLessThan(1)
    expect(afterMiss).toBeLessThan(beforeMiss)
  })

  it('p=1.0 を渡されても（既存データの救済）不正解で下がる', () => {
    expect(updateBKT(1, false)).toBeLessThan(1)
  })

  it('p=0 を渡されても正解で上がる', () => {
    expect(updateBKT(0, true)).toBeGreaterThan(0)
  })

  it('戻り値は常に開区間 (0,1) に収まる', () => {
    for (const p of [0, 1, 0.5, -1, 2]) {
      expect(updateBKT(p, true)).toBeLessThan(1)
      expect(updateBKT(p, true)).toBeGreaterThan(0)
      expect(updateBKT(p, false)).toBeLessThan(1)
      expect(updateBKT(p, false)).toBeGreaterThan(0)
    }
  })
})

describe('clampMastery', () => {
  it('両端を開区間に丸める', () => {
    expect(clampMastery(1)).toBeLessThan(1)
    expect(clampMastery(0)).toBeGreaterThan(0)
    expect(clampMastery(0.42)).toBe(0.42)
  })
  it('NaN は下限に落とす（DB の CHECK 制約違反を防ぐ）', () => {
    expect(clampMastery(Number.NaN)).toBeGreaterThan(0)
    expect(clampMastery(Number.NaN)).toBeLessThan(1)
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
