/** @file
 * 検証: generateAnswer が buildPrompt の結果を LlmClient に渡す
 * @verifies FR-05, AC-05-01
 */
import { describe, it, expect, vi } from 'vitest'
import { generateAnswer } from './generateAnswer'
import { TUTOR_MAX_TOKENS } from '@shared/lib/constants'
import type { LlmClient } from './llm/types'

describe('generateAnswer', () => {
  it('system/messages/model を LlmClient.generate に渡し、結果を返す', async () => {
    const generate = vi.fn(async () => ({
      text: 'こう考えてみよう',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: 'test-model',
    }))
    const llm: LlmClient = { generate }

    const result = await generateAnswer(llm, {
      mode: 'direct',
      question: '質問',
      profileText: null,
      history: [],
      model: 'test-model',
    })

    expect(result.text).toBe('こう考えてみよう')
    expect(generate).toHaveBeenCalledOnce()
    const arg = generate.mock.calls[0][0]
    expect(arg.model).toBe('test-model')
    expect(arg.maxTokens).toBe(TUTOR_MAX_TOKENS)
    expect(arg.system).toContain('伴走者')
    expect(arg.messages.at(-1)).toEqual({ role: 'user', content: '質問' })
  })
})
