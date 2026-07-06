/** @file
 * 検証: モデル別コスト計算
 * @verifies FR-12
 */
import { describe, it, expect } from 'vitest'
import { calculateCost } from './calculateCost'

describe('calculateCost', () => {
  it('既知モデルの単価で計算する（haiku: $1/$5 per M）', () => {
    // 1000 in, 500 out → 1000/1e6*1 + 500/1e6*5 = 0.001 + 0.0025 = 0.0035
    const cost = calculateCost('claude-haiku-4-5', { inputTokens: 1000, outputTokens: 500 })
    expect(cost).toBeCloseTo(0.0035, 8)
  })

  it('別モデルは別単価（sonnet: $3/$15 per M）', () => {
    const cost = calculateCost('claude-sonnet-4-6', { inputTokens: 1000, outputTokens: 500 })
    // 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 8)
  })

  it('未知モデルは 0（トークンは別途記録される）', () => {
    expect(calculateCost('unknown/model', { inputTokens: 9999, outputTokens: 9999 })).toBe(0)
  })

  it('ゼロトークンは 0', () => {
    expect(calculateCost('claude-haiku-4-5', { inputTokens: 0, outputTokens: 0 })).toBe(0)
  })
})
