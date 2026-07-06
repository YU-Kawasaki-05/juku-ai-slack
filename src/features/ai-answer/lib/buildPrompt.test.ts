/** @file
 * 検証: モード別プロンプト構築（伴走者フレーミング + モード戦略 + プロフィール + 履歴）
 * @verifies AC-05-01, AC-05-02, AC-05-03, DEC-25
 */
import { describe, it, expect } from 'vitest'
import { buildPrompt } from './buildPrompt'
import type { LlmMessage } from './llm/types'

describe('buildPrompt', () => {
  const base = { question: '二次方程式の解き方は？', profileText: null, history: [] as LlmMessage[] }

  it('全モード共通で伴走者フレーミングを含む（DEC-25）', () => {
    const { system } = buildPrompt({ ...base, mode: 'socratic' })
    expect(system).toContain('伴走者')
    expect(system).toContain('APIキー') // 内部情報を出さないルール
  })

  it('direct はワークド例題（条件・行動・目的）を指示（AC-05-02）', () => {
    const { system } = buildPrompt({ ...base, mode: 'direct' })
    expect(system).toContain('条件・行動・目的')
    expect(system).toContain('direct')
  })

  it('socratic は確認質問1問・末尾終了を指示（AC-05-03）', () => {
    const { system } = buildPrompt({ ...base, mode: 'socratic' })
    expect(system).toContain('1問だけ')
    expect(system).toContain('socratic')
  })

  it('confirmation は確認質問のみ', () => {
    const { system } = buildPrompt({ ...base, mode: 'confirmation' })
    expect(system).toContain('confirmation')
  })

  it('profileText があれば system に含める（無ければ含めない）', () => {
    const withProfile = buildPrompt({ ...base, mode: 'direct', profileText: '苦手: 計算ミスが多い' })
    expect(withProfile.system).toContain('計算ミスが多い')
    const without = buildPrompt({ ...base, mode: 'direct' })
    expect(without.system).not.toContain('この生徒のメモ')
  })

  it('画像があれば user メッセージをテキスト+画像パーツにする（FR-06）', () => {
    const { messages } = buildPrompt({
      ...base,
      mode: 'direct',
      imageDataUrls: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
    })
    const last = messages.at(-1)!
    expect(Array.isArray(last.content)).toBe(true)
    const parts = last.content as Array<{ type: string; text?: string; dataUrl?: string }>
    expect(parts[0]).toEqual({ type: 'text', text: base.question })
    expect(parts.filter((p) => p.type === 'image')).toHaveLength(2)
  })

  it('画像なしなら user content は文字列', () => {
    const { messages } = buildPrompt({ ...base, mode: 'direct' })
    expect(typeof messages.at(-1)!.content).toBe('string')
  })

  it('履歴の後に現在の質問を user として積む', () => {
    const history: LlmMessage[] = [
      { role: 'user', content: '前の質問' },
      { role: 'assistant', content: '前の回答' },
    ]
    const { messages } = buildPrompt({ ...base, mode: 'direct', history })
    expect(messages).toHaveLength(3)
    expect(messages[2]).toEqual({ role: 'user', content: base.question })
  })
})
