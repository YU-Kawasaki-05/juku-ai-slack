/** @file
 * 機能: モード選択済みの入力から Tutor 応答を生成する
 * 入力: LlmClient, GenerateAnswerInput
 * 出力: LlmResult（text, usage, model）
 * 例外: LlmClient が投げる AppError を伝播
 * 依存: buildPrompt, LlmClient
 * 副作用: LLM 呼び出し（LlmClient 経由）
 * @implements FR-05
 */
import { TUTOR_MAX_TOKENS } from '@shared/lib/constants'
import type { LlmClient, LlmResult } from './llm/types'
import { buildPrompt, type BuildPromptInput } from './buildPrompt'

export interface GenerateAnswerInput extends BuildPromptInput {
  model: string
  maxTokens?: number
}

export async function generateAnswer(
  llm: LlmClient,
  input: GenerateAnswerInput,
): Promise<LlmResult> {
  const { system, messages } = buildPrompt({
    mode: input.mode,
    question: input.question,
    profileText: input.profileText,
    history: input.history,
    ragChunks: input.ragChunks,
  })

  return llm.generate({
    system,
    messages,
    model: input.model,
    maxTokens: input.maxTokens ?? TUTOR_MAX_TOKENS,
  })
}
