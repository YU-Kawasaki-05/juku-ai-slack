/** @file
 * 検証: Evaluator の JSON 抽出・Zod検証・リトライ・出力打ち切り時の増枠
 * @verifies FR-23, AC-23-04, A-15, D-5
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

  // --- A-15 / G-3: 出力打ち切り ---
  it('CoT スキーマを書き切れる max_tokens を確保している（500 では恒常的に切れていた）', async () => {
    const { llm, generate } = llmReturning(validJson)
    await evaluate(llm, { botQuestion: 'Q', studentReply: 'A' }, 'm')
    expect(generate.mock.calls[0][0].maxTokens).toBeGreaterThanOrEqual(900)
  })

  it('打ち切り（truncated）で解釈できなかったらリトライ時に枠を倍にする（A-15）', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        text: '{"reasoning":"途中で切れ',
        usage: { inputTokens: 50, outputTokens: 900 },
        model: 'm',
        truncated: true,
      })
      .mockResolvedValueOnce({
        text: validJson,
        usage: { inputTokens: 50, outputTokens: 300 },
        model: 'm',
      })
    const { evaluation } = await evaluate({ generate }, { botQuestion: 'Q', studentReply: 'A' }, 'm')
    expect(evaluation.signal).toBe('correct')
    expect(generate.mock.calls[1][0].maxTokens).toBe(generate.mock.calls[0][0].maxTokens * 2)
  })

  it('打ち切りでない失敗のリトライは枠を据え置く（無駄な出力課金を増やさない）', async () => {
    const { llm, generate } = llmReturning('これは JSON ではありません', validJson)
    await evaluate(llm, { botQuestion: 'Q', studentReply: 'A' }, 'm')
    expect(generate.mock.calls[1][0].maxTokens).toBe(generate.mock.calls[0][0].maxTokens)
  })

  it('打ち切りのままリトライも失敗したら理由を内部メッセージに残す（A-15）', async () => {
    const generate = vi.fn().mockResolvedValue({
      text: '{"reasoning":"切れ',
      usage: { inputTokens: 50, outputTokens: 900 },
      model: 'm',
      truncated: true,
    })
    await expect(
      evaluate({ generate }, { botQuestion: 'Q', studentReply: 'A' }, 'm'),
    ).rejects.toMatchObject({
      code: 'AI_RESPONSE_FAILED',
      cause: expect.stringContaining('出力トークン上限'),
    })
  })

  // --- D-5 / G-6: 出力長の丸め ---
  it('topic_id / subject は DB の VARCHAR 幅に丸める（BKT の恒久停止を防ぐ）', async () => {
    const longJson = JSON.stringify({
      reasoning: 'r',
      signal: 'correct',
      identified_misconception: null,
      topic_id: 'あ'.repeat(500),
      subject: 'い'.repeat(300),
      confidence: 0.9,
    })
    const { llm, generate } = llmReturning(longJson)
    const { evaluation } = await evaluate(llm, { botQuestion: 'Q', studentReply: 'A' }, 'm')
    expect(evaluation.topic_id).toHaveLength(100)
    expect(evaluation.subject).toHaveLength(50)
    // 長さだけを理由に評価全体を捨てない（リトライしていない）
    expect(generate).toHaveBeenCalledOnce()
  })
})
