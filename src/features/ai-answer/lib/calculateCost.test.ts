/** @file
 * 検証: モデル別コスト計算（完全一致 → `provider/model` サフィックス照合）
 * @verifies FR-12, E-3
 */
import { describe, it, expect } from 'vitest'
import { calculateCost } from './calculateCost'
import { MODEL_PRICING, findModelPrice } from '@shared/lib/constants'

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

  // E-3: .env.example が推奨する OpenRouter 形式で 0 円表示にならないこと
  it.each([
    ['deepseek/deepseek-chat', 'deepseek-chat'],
    ['openai/gpt-4o-mini', 'gpt-4o-mini'],
    ['openai/gpt-4o', 'gpt-4o'],
    ['anthropic/claude-haiku-4-5', 'claude-haiku-4-5'],
  ])('OpenRouter 形式 %s は素の名前 %s と同額', (prefixed, bare) => {
    const usage = { inputTokens: 12_345, outputTokens: 6_789 }
    const cost = calculateCost(prefixed, usage)
    expect(cost).toBeGreaterThan(0)
    expect(cost).toBe(calculateCost(bare, usage))
  })

  it('MODEL_PRICING に未登録の provider/ でもサフィックスが一致すれば課金される', () => {
    // 例: OpenRouter 以外のゲートウェイが独自プレフィックスを付けるケース
    const usage = { inputTokens: 1000, outputTokens: 500 }
    expect(calculateCost('some-gateway/claude-haiku-4-5', usage)).toBeCloseTo(0.0035, 8)
  })

  it('サフィックスも未登録なら 0（未知モデル）', () => {
    expect(calculateCost('openai/o9-imaginary', { inputTokens: 1000, outputTokens: 1000 })).toBe(0)
  })
})

describe('findModelPrice', () => {
  it('プロトタイプ由来のキーを単価として拾わない', () => {
    expect(findModelPrice('constructor')).toBeUndefined()
    expect(findModelPrice('__proto__')).toBeUndefined()
    expect(findModelPrice('toString')).toBeUndefined()
  })

  it('OpenRouter 形式のキーは素の名前と同一の単価オブジェクトを共有する（値のドリフト防止）', () => {
    expect(MODEL_PRICING['deepseek/deepseek-chat']).toBe(MODEL_PRICING['deepseek-chat'])
    expect(MODEL_PRICING['openai/gpt-4o']).toBe(MODEL_PRICING['gpt-4o'])
  })
})
