/** @file
 * 機能: レポート Markdown を見出し単位でチャンク分割する純粋関数
 * 入力: markdown, maxChars
 * 出力: チャンク文字列の配列（空要素なし）
 * 例外: なし
 * 依存: 定数
 * @implements FR-10, BR-10-01, BR-10-02, AC-10-01
 */
import { RAG_CHUNK_MAX_CHARS } from '@shared/lib/constants'

/** 見出し（##, ###）単位で分割。長すぎるチャンクは空行（段落）でさらに分割 */
export function chunkReport(markdown: string, maxChars: number = RAG_CHUNK_MAX_CHARS): string[] {
  const text = markdown.trim()
  if (!text) return []

  // 見出し行の直前で区切る（見出しはその節に含める）
  const lines = text.split('\n')
  const sections: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (/^#{2,3}\s/.test(line) && current.length > 0) {
      sections.push(current.join('\n').trim())
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) sections.push(current.join('\n').trim())

  // 長すぎる節を段落（空行）でさらに束ねて分割
  const chunks: string[] = []
  for (const section of sections.filter((s) => s.length > 0)) {
    if (section.length <= maxChars) {
      chunks.push(section)
      continue
    }
    const paragraphs = section.split(/\n\s*\n/)
    let buf = ''
    for (const p of paragraphs) {
      if (buf && (buf + '\n\n' + p).length > maxChars) {
        chunks.push(buf.trim())
        buf = p
      } else {
        buf = buf ? `${buf}\n\n${p}` : p
      }
    }
    if (buf.trim()) chunks.push(buf.trim())
  }

  return chunks.filter((c) => c.length > 0)
}
