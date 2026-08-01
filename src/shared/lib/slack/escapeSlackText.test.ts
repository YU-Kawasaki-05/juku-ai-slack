/** @file
 * 検証: Slack 投稿テキストのエスケープと、受信側の復号との往復整合
 * @verifies C-3, G-2
 */
import { describe, it, expect } from 'vitest'
import { escapeSlackText } from './escapeSlackText'
import { stripBotMention } from '@features/slack-events'

describe('escapeSlackText', () => {
  it('& < > をエスケープする', () => {
    expect(escapeSlackText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
  })

  it('& を先に置換する（二重エスケープしない）', () => {
    expect(escapeSlackText('<')).toBe('&lt;')
    expect(escapeSlackText('&lt;')).toBe('&amp;lt;')
  })

  it('チャンネル全員通知のインジェクションを無害化する（C-3）', () => {
    expect(escapeSlackText('やあ <!channel> みんな')).toBe('やあ &lt;!channel&gt; みんな')
    expect(escapeSlackText('<@U123>')).toBe('&lt;@U123&gt;')
    expect(escapeSlackText('<!here>')).toBe('&lt;!here&gt;')
  })

  it('通常の日本語テキストは変化しない', () => {
    expect(escapeSlackText('一緒に整理しよう！')).toBe('一緒に整理しよう！')
  })
})

describe('受信復号 ↔ 送信エスケープの往復（G-2 × C-3）', () => {
  const BOT = 'U_BOT'

  it('不等号が往復で壊れない（Slack 表示上は同じ文字列に戻る）', () => {
    // Slack から届く生テキスト
    const incoming = '<@U_BOT> x &lt; 5 &amp; y &gt; 2'
    // LLM に渡る形（復号済み）
    const forLlm = stripBotMention(incoming, BOT)
    expect(forLlm).toBe('x < 5 & y > 2')

    // LLM が同じ内容を返したとして、投稿時に再エスケープすると受信時の表現に戻る
    expect(escapeSlackText(forLlm)).toBe('x &lt; 5 &amp; y &gt; 2')
  })

  it('LLM が生の < を出しても Slack の制御シーケンスにならない', () => {
    const llmOutput = '不等式 x < 5 を満たすのは <!channel> ではなく x = 4 など'
    expect(escapeSlackText(llmOutput)).toBe(
      '不等式 x &lt; 5 を満たすのは &lt;!channel&gt; ではなく x = 4 など',
    )
  })
})
