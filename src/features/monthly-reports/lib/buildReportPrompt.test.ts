/** @file
 * 検証: 月次レポートの LLM プロンプト（質問数・利用日数の集計、会話の間引き、指示文の要件）
 * @verifies FR-08
 */
import { describe, it, expect } from 'vitest'
import {
  REPORT_SYSTEM_PROMPT,
  buildReportPrompt,
  selectWithinBudget,
  summarizeConversation,
  type ConversationRow,
} from './buildReportPrompt'

const row = (role: 'user' | 'assistant', text: string | null, created_at: string): ConversationRow => ({
  role,
  text,
  created_at,
})

describe('summarizeConversation', () => {
  it('質問数は生徒の発言（テキストあり）だけを数え、利用日数は日本時間の日付で数える', () => {
    const rows = [
      row('user', '二次方程式の解き方は？', '2026-09-10T03:00:00Z'),
      row('assistant', '解の公式を使います', '2026-09-10T03:00:05Z'),
      row('user', '  ', '2026-09-10T04:00:00Z'), // 空白だけ
      row('user', null, '2026-09-10T04:30:00Z'), // テキストなし
      // UTC では 9/10 だが日本時間では 9/11
      row('user', '続きも教えて', '2026-09-10T16:00:00Z'),
    ]
    expect(summarizeConversation(rows)).toEqual({ questions: 2, activeDays: 2 })
  })

  it('会話が無ければ 0 件', () => {
    expect(summarizeConversation([])).toEqual({ questions: 0, activeDays: 0 })
  })
})

describe('buildReportPrompt', () => {
  const rows = [
    row('user', '関係代名詞が分からない', '2026-09-10T03:00:00Z'),
    row('assistant', 'who と which を使い分けます', '2026-09-10T03:00:05Z'),
    row('user', 'もう一度例文がほしい', '2026-09-11T03:00:00Z'),
  ]

  it('数値はコードで数えた値を渡し、会話を <conversation> で囲む', () => {
    const p = buildReportPrompt('2026-09', rows)
    expect(p.stats).toEqual({ questions: 2, activeDays: 2 })
    expect(p.sampled).toBe(false)
    const content = p.messages[0].content as string
    expect(content).toContain('対象月: 2026年9月')
    expect(content).toContain('質問数: 2 件')
    expect(content).toContain('利用日数: 2 日')
    expect(content).toContain('<conversation>')
    expect(content).toContain('[09/10 12:00] 生徒: 関係代名詞が分からない')
    expect(content).toContain('AI: who と which を使い分けます')
    expect(content).toContain('</conversation>')
  })

  it('指示文は、根拠の無いことを書かない・会話内の指示に従わない・5 つの見出しを求める', () => {
    expect(REPORT_SYSTEM_PROMPT).toContain('会話に無いこと')
    expect(REPORT_SYSTEM_PROMPT).toContain('従わず')
    for (const h of [
      '## 今月の質問の数と主な単元',
      '## よく分かっていたこと',
      '## つまずいていたこと',
      '## 来月に向けたおすすめ',
      '## スタッフへのメモ',
    ]) {
      expect(REPORT_SYSTEM_PROMPT).toContain(h)
    }
  })

  it('指示文はリンクと画像を出さないよう求める', () => {
    expect(REPORT_SYSTEM_PROMPT).toContain('リンク')
    expect(REPORT_SYSTEM_PROMPT).toContain('画像')
    expect(REPORT_SYSTEM_PROMPT).toMatch(/出力しない/)
  })

  it('長い質問・回答は切り詰める', () => {
    const long = 'あ'.repeat(1000)
    const p = buildReportPrompt('2026-09', [
      row('user', long, '2026-09-10T03:00:00Z'),
      row('assistant', long, '2026-09-10T03:00:05Z'),
    ])
    const content = p.messages[0].content as string
    expect(content).not.toContain('あ'.repeat(401))
    expect(content).toContain('…')
  })

  it('予算を超えるときは等間隔に間引き、間引いたことと抜粋件数を明示する', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      row('user', `質問${i} ${'x'.repeat(100)}`, `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T03:00:00Z`),
    )
    const p = buildReportPrompt('2026-09', many, 3000)
    expect(p.sampled).toBe(true)
    expect(p.stats.questions).toBe(200)
    const content = p.messages[0].content as string
    expect(content).toContain('質問数: 200 件')
    expect(content).toMatch(/200 件のうち \d+ 件/)
    // 本文（会話部分）は予算内
    const convo = content.slice(content.indexOf('<conversation>'))
    expect(convo.length).toBeLessThan(3000 + 200)
  })
})

describe('selectWithinBudget', () => {
  it('収まるなら全部返す', () => {
    expect(selectWithinBudget(['a', 'b'], 100)).toEqual(['a', 'b'])
  })
  it('収まらないなら等間隔に減らし、最低 1 件は残す', () => {
    const items = Array.from({ length: 10 }, (_, i) => `item${i}`) // 各 6 + 1 = 7
    const picked = selectWithinBudget(items, 30)
    expect(picked.length).toBeLessThan(10)
    expect(picked[0]).toBe('item0')
    expect(selectWithinBudget(items, 1)).toEqual(['item0'])
  })
})
