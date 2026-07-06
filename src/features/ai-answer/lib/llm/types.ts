/** @file
 * 機能: プロバイダ非依存の LLM クライアント抽象（ポート）
 * 入力/出力: LlmGenerateParams → LlmResult
 * 依存: なし（アダプタが実装する）
 * セキュリティ: プロバイダ固有の鍵はアダプタ側に閉じる
 * @implements FR-05
 */
export type LlmRole = 'system' | 'user' | 'assistant'

export interface LlmMessage {
  role: LlmRole
  content: string
}

export interface LlmGenerateParams {
  /** システムプロンプト（省略可。指定時は messages の先頭に system として付与） */
  system?: string
  messages: LlmMessage[]
  model: string
  maxTokens?: number
  /** 省略時はプロバイダ既定 */
  temperature?: number
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface LlmResult {
  text: string
  usage: LlmUsage
  /** 実際に応答したモデル（プロバイダが返す値。無ければ要求モデル） */
  model: string
}

/**
 * LLM プロバイダの抽象。OpenAI 互換 / Anthropic 等はこれを実装する。
 * ビジネスロジック（モード選択・プロンプト構築）はこのインターフェースにのみ依存する。
 */
export interface LlmClient {
  generate(params: LlmGenerateParams): Promise<LlmResult>
}
