/** @file
 * 機能: モデルとトークン使用量から推定コスト（USD）を計算する純粋関数
 * 入力: model, LlmUsage
 * 出力: 推定コスト（USD, number）
 * 例外: なし（未知モデルは 0 を返す。トークン数自体は別途記録される）
 * 依存: MODEL_PRICING
 * @implements FR-12
 */
import { MODEL_PRICING } from '@shared/lib/constants'
import type { LlmUsage } from './llm/types'

export function calculateCost(model: string, usage: LlmUsage): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) {
    // 未知モデル: コストは 0 とする（トークン数は usage ログに残る）
    return 0
  }
  const cost =
    (usage.inputTokens / 1_000_000) * pricing.inputPerM +
    (usage.outputTokens / 1_000_000) * pricing.outputPerM
  // 過度な丸めを避けつつ、極小値を保持（NUMERIC(12,8) に収まる）
  return Math.round(cost * 1e8) / 1e8
}
