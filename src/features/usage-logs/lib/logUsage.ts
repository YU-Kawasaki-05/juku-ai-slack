/** @file
 * 機能: ai_usage_logs への LLM 利用量・コスト記録
 * 入力: Supabase クライアント, LogUsageParams
 * 出力: なし
 * 例外: 記録失敗は主処理を止めない（console.error のみ）
 * 依存: ai_usage_logs テーブル
 * 副作用: DB 書き込み
 * セキュリティ: person_id は channel_id 解決済みの値のみ
 * @implements FR-12
 */
import type { ServerDb } from '@shared/types/db'
import type { LlmUsage } from '@features/ai-answer'

export interface LogUsageParams {
  personId: string
  channelId: string
  threadTs: string
  messageTs: string
  model: string
  usage: LlmUsage
  estimatedCost: number
  hasImage?: boolean
  latencyMs?: number
}

export async function logUsage(db: ServerDb, params: LogUsageParams): Promise<void> {
  const { error } = await db.from('ai_usage_logs').insert({
    person_id: params.personId,
    slack_channel_id: params.channelId,
    thread_ts: params.threadTs,
    message_ts: params.messageTs,
    model: params.model,
    input_tokens: params.usage.inputTokens,
    output_tokens: params.usage.outputTokens,
    total_tokens: params.usage.inputTokens + params.usage.outputTokens,
    estimated_cost: params.estimatedCost,
    has_image: params.hasImage ?? false,
    latency_ms: params.latencyMs ?? null,
  })
  if (error) {
    console.error('[logUsage] failed to persist usage log:', error.message)
  }
}
