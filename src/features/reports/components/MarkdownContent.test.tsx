/** @file
 * 検証: レポート本文の表示で画像を出さない（LLM が作った本文経由の外部アクセス防止）。リンクは従来どおり
 * @verifies FR-16, FR-08
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownContent } from './MarkdownContent'

describe('MarkdownContent', () => {
  it('画像（![](url)）は img を出さない', () => {
    const { container } = render(
      <MarkdownContent markdown={'本文\n\n![追跡](https://attacker.example/pixel.png?x=1)\n\n<img src="https://attacker.example/raw.png">'} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('attacker.example/pixel.png')
    expect(screen.getByText('本文')).toBeInTheDocument()
  })

  it('リンクはクリックされるまで外部へ出ない通常の a（新しいタブ・noopener）のまま', () => {
    render(<MarkdownContent markdown={'[参考](https://example.com/doc)'} />)
    const a = screen.getByRole('link', { name: '参考' })
    expect(a).toHaveAttribute('href', 'https://example.com/doc')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('javascript: のリンクは href が落とされる', () => {
    render(<MarkdownContent markdown={'[x](javascript:alert(1))'} />)
    const a = screen.queryByRole('link', { name: 'x' })
    expect(a?.getAttribute('href') ?? '').not.toContain('javascript:')
  })
})
