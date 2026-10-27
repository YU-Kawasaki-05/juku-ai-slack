/** @file
 * 検証: 添付・ダウンロードの .md ファイル名（YYYY-MM_<表示名>.md）と文字の置き換え
 * @verifies FR-08
 */
import { describe, it, expect } from 'vitest'
import { buildAttachmentFileName, sanitizeFileNamePart } from './attachmentName'

describe('buildAttachmentFileName', () => {
  it('基本形は YYYY-MM_<表示名>.md', () => {
    expect(buildAttachmentFileName('2026-09', '生徒A')).toBe('2026-09_生徒A.md')
  })

  it('ファイル名に使えない文字・空白を _ に置き換える', () => {
    expect(buildAttachmentFileName('2026-09', 'a/b\\c:d*e?f"g<h>i|j k')).toBe('2026-09_a_b_c_d_e_f_g_h_i_j_k.md')
  })

  it('制御文字・改行（ヘッダ注入）を取り除く', () => {
    const name = buildAttachmentFileName('2026-09', 'x\r\nSet-Cookie: a=b')
    expect(name).not.toMatch(/[\r\n]/)
    expect(name).toBe('2026-09_x_Set-Cookie_a=b.md')
  })

  it('表示方向を変える Unicode 制御文字（LRM/RLM・U+202A〜202E・U+2066〜2069）を取り除く', () => {
    const bidi = '\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069'
    // 「exe.mdﾠ」のように拡張子の見かけを入れ替える典型例
    expect(buildAttachmentFileName('2026-09', `a${bidi}b\u202Egpj.exe`)).toBe('2026-09_abgpj.exe.md')
    expect(buildAttachmentFileName('2026-09', bidi)).toBe('2026-09_生徒.md')
    for (const ch of bidi) expect(buildAttachmentFileName('2026-09', `x${ch}y`)).toBe('2026-09_xy.md')
  })

  it('先頭のドットや ../ でパスをたどれない', () => {
    expect(buildAttachmentFileName('2026-09', '../../etc/passwd')).toBe('2026-09_etc_passwd.md')
    expect(buildAttachmentFileName('2026-09', '.hidden')).toBe('2026-09_hidden.md')
  })

  it('空・記号だけの名前は「生徒」にする', () => {
    expect(buildAttachmentFileName('2026-09', '')).toBe('2026-09_生徒.md')
    expect(buildAttachmentFileName('2026-09', '///')).toBe('2026-09_生徒.md')
    expect(buildAttachmentFileName('2026-09', '   ')).toBe('2026-09_生徒.md')
  })

  it('長い名前は切り詰める（サロゲートペアを壊さない）', () => {
    const emoji = '😀'.repeat(100)
    const part = sanitizeFileNamePart(emoji)
    expect(Array.from(part).length).toBe(60)
    expect(part).not.toContain('�')
  })

  it('同じ名前の生徒がいれば _2, _3 で区別する', () => {
    const used = new Set<string>()
    expect(buildAttachmentFileName('2026-09', '同名', used)).toBe('2026-09_同名.md')
    expect(buildAttachmentFileName('2026-09', '同名', used)).toBe('2026-09_同名_2.md')
    expect(buildAttachmentFileName('2026-09', '同名', used)).toBe('2026-09_同名_3.md')
  })

  it('表示名が違っても置き換え後に同じになるなら区別する', () => {
    const used = new Set<string>()
    expect(buildAttachmentFileName('2026-09', 'a/b', used)).toBe('2026-09_a_b.md')
    expect(buildAttachmentFileName('2026-09', 'a:b', used)).toBe('2026-09_a_b_2.md')
  })
})
