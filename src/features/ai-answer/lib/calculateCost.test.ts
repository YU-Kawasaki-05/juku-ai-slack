/** @file
 * 検証: モデル別コスト計算（完全一致 → `provider/model` サフィックス照合）
 * @verifies FR-12, E-3
 */
import { describe, it, expect } from 'vitest'
import { calculateCost } from './calculateCost'
import { MODEL_PRICING, findModelPrice } from '@shared/lib/constants'
import { findUnpricedModels } from '@features/usage-logs'

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

  // 本番移行 §3-4: LLM_MODEL_DEFAULT / LLM_MODEL_COMPLEX が $0.00 で積み上がらないこと
  it('本番既定の gpt-5.6-luna を単価 $0.20/$1.20 で計算する', () => {
    // 10,000 in, 1,000 out → 10000/1e6*0.2 + 1000/1e6*1.2 = 0.002 + 0.0012 = 0.0032
    const cost = calculateCost('gpt-5.6-luna', { inputTokens: 10_000, outputTokens: 1_000 })
    expect(cost).toBeCloseTo(0.0032, 8)
  })

  it('画像用の gpt-5.6-terra は単価 $2/$12（luna より高い）', () => {
    const usage = { inputTokens: 10_000, outputTokens: 1_000 }
    // 0.02 + 0.012 = 0.032
    expect(calculateCost('gpt-5.6-terra', usage)).toBeCloseTo(0.032, 8)
    expect(calculateCost('gpt-5.6-terra', usage)).toBeGreaterThan(
      calculateCost('gpt-5.6-luna', usage),
    )
  })

  // E-3: .env.example が推奨する OpenRouter 形式で 0 円表示にならないこと
  it.each([
    ['deepseek/deepseek-chat', 'deepseek-chat'],
    ['openai/gpt-4o-mini', 'gpt-4o-mini'],
    ['openai/gpt-4o', 'gpt-4o'],
    ['anthropic/claude-haiku-4-5', 'claude-haiku-4-5'],
    ['openai/gpt-5.6-luna', 'gpt-5.6-luna'],
    ['openai/gpt-5.6-terra', 'gpt-5.6-terra'],
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
    // ドットを含むモデル名でもサフィックス照合が効く
    expect(calculateCost('some-gateway/gpt-5.6-luna', usage)).toBeCloseTo(0.0008, 8)
  })

  it('サフィックスも未登録なら 0（未知モデル）', () => {
    expect(calculateCost('openai/o9-imaginary', { inputTokens: 1000, outputTokens: 1000 })).toBe(0)
  })
})

// 本番移行 §3-0 / §3-4: 実キーで疎通確認済みの本番モデル（2026-08-29 実測）。
// ここが未登録に戻ると `/admin/usage` に「単価が未登録のモデル」警告が出て、
// 累計コストが $0.00 のまま積み上がる（記録済みログは遡って再計算されない）。
describe('本番モデルの単価登録（/admin/usage の未登録警告が出ないこと）', () => {
  const PRODUCTION_MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra']

  it.each(PRODUCTION_MODELS)('%s の単価を MODEL_PRICING から引ける', (model) => {
    expect(findModelPrice(model)).toBeDefined()
  })

  it('本番の 2 モデルは未登録として列挙されない（素の名前 / OpenRouter 形式とも）', () => {
    expect(findUnpricedModels(PRODUCTION_MODELS)).toEqual([])
    expect(findUnpricedModels(PRODUCTION_MODELS.map((m) => `openai/${m}`))).toEqual([])
  })

  it('未登録モデルは 0 のままで、警告にも列挙される（判定が全部通る実装になっていない）', () => {
    const usage = { inputTokens: 10_000, outputTokens: 1_000 }
    expect(calculateCost('gpt-5.6-unregistered', usage)).toBe(0)
    expect(findUnpricedModels([...PRODUCTION_MODELS, 'gpt-5.6-unregistered'])).toEqual([
      'gpt-5.6-unregistered',
    ])
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
    expect(MODEL_PRICING['openai/gpt-5.6-luna']).toBe(MODEL_PRICING['gpt-5.6-luna'])
    expect(MODEL_PRICING['openai/gpt-5.6-terra']).toBe(MODEL_PRICING['gpt-5.6-terra'])
  })
})
