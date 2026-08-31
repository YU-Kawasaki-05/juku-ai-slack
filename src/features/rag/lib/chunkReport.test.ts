/** @file
 * 検証: レポート Markdown のチャンク分割
 * @verifies FR-10, AC-10-01, BR-10-01, BR-10-02
 */
import { describe, it, expect } from 'vitest'
import { chunkReport } from './chunkReport'

describe('chunkReport', () => {
  it('見出し（##/###）単位で分割する（BR-10-01）', () => {
    const md = `## 数学\n二次方程式の理解が進んだ。\n\n## 英語\n時制でつまずくことが多い。`
    const chunks = chunkReport(md)
    expect(chunks.length).toBe(2)
    expect(chunks[0]).toContain('数学')
    expect(chunks[0]).toContain('二次方程式')
    expect(chunks[1]).toContain('英語')
  })

  it('見出しはその節に含まれる', () => {
    const chunks = chunkReport('## A\n本文A\n### A-1\n本文A1')
    // ## A と ### A-1 で2チャンク
    expect(chunks.length).toBe(2)
    expect(chunks[1]).toContain('### A-1')
  })

  it('空・空白のみは空配列', () => {
    expect(chunkReport('')).toEqual([])
    expect(chunkReport('   \n  ')).toEqual([])
  })

  it('見出しなしの長文は maxChars で段落分割する', () => {
    const para = 'あ'.repeat(400)
    const md = [para, para, para].join('\n\n') // 3段落 ~1200字
    const chunks = chunkReport(md, 500)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(900)
  })

  it('maxChars 以下の節は分割しない', () => {
    const chunks = chunkReport('## X\n短い本文', 1500)
    expect(chunks.length).toBe(1)
  })

  it('ハードスライスでサロゲートペアを分断しない（絵文字が境界に来るケース）', () => {
    // 999字 + 絵文字（サロゲートペア）+ 500字 → UTF-16 の slice(0,1000) だと絵文字が割れる
    const p = 'あ'.repeat(999) + '😀' + 'い'.repeat(500)
    const chunks = chunkReport(p, 1000)

    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      // 孤立サロゲート（ペアになっていない上位/下位サロゲート）が残っていないこと
      expect(c).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
      expect(c).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    }
    expect(chunks.join('')).toContain('😀')
  })

  it('絵文字だけの長い段落もコードポイント単位で切る', () => {
    const p = '😀'.repeat(300)
    const chunks = chunkReport(p, 100)
    expect(chunks.length).toBe(3)
    for (const c of chunks) expect([...c].length).toBe(100)
  })
})
