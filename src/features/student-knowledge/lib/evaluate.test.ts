/** @file
 * 検証: Evaluator の JSON 抽出・Zod検証・リトライ
 * @verifies FR-23, AC-23-04
 */
import { describe, it, expect, vi } from 'vitest'
import { evaluate } from './evaluate'
import type { LlmClient } from '@features/ai-answer'

const validJson = JSON.stringify({
  reasoning: '生徒は判別式を正しく使えている',
  signal: 'correct',
  identified_misconception: null,
  topic_id: '二次方程式',
  subject: '数学',
  confidence: 0.9,
})

function llmReturning(...texts: string[]): { llm: LlmClient; generate: ReturnType<typeof vi.fn> } {
  const generate = vi.fn()
  for (const t of texts) {
    generate.mockResolvedValueOnce({ text: t, usage: { inputTokens: 50, outputTokens: 30 }, model: 'm' })
  }
  return { llm: { generate }, generate }
}

describe('evaluate', () => {
  it('素の JSON を解釈して Evaluation を返す', async () => {
    const { llm } = llmReturning(validJson)
    const { evaluation } = await evaluate(llm, { botQuestion: 'Q', studentReply: 'A' }, 'm')
    expect(evaluation.signal).toBe('correct')
    expect(evaluation.topic_id).toBe('二次方程式')
    expect(evaluation.reasoning).not.toBe('')
  })

  it('コードフェンス付き JSON も抽出できる', async () => {
    const { llm } = llmReturning('```json\n' + validJson + '\n```')
    const { evaluation } = await evaluate(llm, { botQuestion: 'Q', studentReply: 'A' }, 'm')
    expect(evaluation.signal).toBe('correct')
  })

  it('1回目が不正JSONでもリトライで回復する', async () => {
    const { llm, generate } = llmReturning('これは JSON ではありません', validJson)
    const { evaluation } = await evaluate(llm, { botQuestion: 'Q', studentReply: 'A' }, 'm')
    expect(evaluation.signal).toBe('correct')
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('リトライしても不正なら AiResponseFailedError', async () => {
    const { llm } = llmReturning('だめ', 'やはりだめ')
    await expect(evaluate(llm, { botQuestion: 'Q', studentReply: 'A' }, 'm')).rejects.toMatchObject(
      { code: 'AI_RESPONSE_FAILED' },
    )
  })

  it('スキーマ違反（signal 不正値）はリトライ対象', async () => {
    const bad = JSON.stringify({ reasoning: 'r', signal: 'maybe', identified_misconception: null, topic_id: 't', subject: 's', confidence: 0.5 })
    const { llm, generate } = llmReturning(bad, validJson)
    await evaluate(llm, { botQuestion: 'Q', studentReply: 'A' }, 'm')
    expect(generate).toHaveBeenCalledTimes(2)
  })
})
