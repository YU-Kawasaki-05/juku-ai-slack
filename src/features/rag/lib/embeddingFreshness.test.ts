/** @file
 * 検証: Embedding 再生成要否の判定（文字列比較ではなくエポック比較）
 * @verifies FR-16, BR-16-03
 */
import { describe, it, expect } from 'vitest'
import { needsEmbeddingRebuild } from './embeddingFreshness'

describe('needsEmbeddingRebuild', () => {
  it('未生成（null）は要再生成', () => {
    expect(needsEmbeddingRebuild(null, '2026-08-02T10:00:00+00:00')).toBe(true)
  })

  it('embedding が本文更新より新しければ不要', () => {
    expect(needsEmbeddingRebuild('2026-08-02T10:00:01+00:00', '2026-08-02T10:00:00+00:00')).toBe(
      false,
    )
  })

  it('embedding が本文更新より古ければ要再生成', () => {
    expect(needsEmbeddingRebuild('2026-08-02T09:59:59+00:00', '2026-08-02T10:00:00+00:00')).toBe(
      true,
    )
  })

  it('オフセット表記が違っても同一時刻なら不要（文字列比較だと誤判定する）', () => {
    // 2026-08-02T19:00:00+09:00 === 2026-08-02T10:00:00+00:00
    expect(needsEmbeddingRebuild('2026-08-02T19:00:00+09:00', '2026-08-02T10:00:00+00:00')).toBe(
      false,
    )
    // JST 表記のほうが新しいケース（文字列比較では '2' < '2' … '19' > '10' で偶然通るが、
    // 逆順のオフセットでは破綻する）
    expect(needsEmbeddingRebuild('2026-08-02T10:00:00+00:00', '2026-08-02T19:00:01+09:00')).toBe(
      true,
    )
  })

  it('パース不能な embeddings_updated_at は安全側（要再生成）', () => {
    expect(needsEmbeddingRebuild('not-a-date', '2026-08-02T10:00:00+00:00')).toBe(true)
  })
})
