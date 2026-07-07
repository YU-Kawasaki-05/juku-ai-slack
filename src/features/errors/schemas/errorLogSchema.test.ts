/** @file
 * 検証: エラーログ更新の入力バリデーション
 * @verifies AC-17-02, AC-17-03
 */
import { describe, it, expect } from 'vitest'
import { errorNotesSchema, resolveErrorSchema } from './errorLogSchema'

const id = '11111111-1111-4111-8111-111111111111'

describe('resolveErrorSchema', () => {
  it('resolved は "true"/"false" 文字列を boolean に変換', () => {
    const on = resolveErrorSchema.safeParse({ id, resolved: 'true' })
    expect(on.success).toBe(true)
    if (on.success) expect(on.data.resolved).toBe(true)

    const off = resolveErrorSchema.safeParse({ id, resolved: 'false' })
    expect(off.success).toBe(true)
    if (off.success) expect(off.data.resolved).toBe(false)
  })

  it('不正値・不正 id はエラー', () => {
    expect(resolveErrorSchema.safeParse({ id, resolved: 'yes' }).success).toBe(false)
    expect(resolveErrorSchema.safeParse({ id: 'x', resolved: 'true' }).success).toBe(false)
  })
})

describe('errorNotesSchema', () => {
  it('空メモは null に正規化・2000文字上限', () => {
    const empty = errorNotesSchema.safeParse({ id, notes: '  ' })
    expect(empty.success).toBe(true)
    if (empty.success) expect(empty.data.notes).toBeNull()

    expect(errorNotesSchema.safeParse({ id, notes: 'あ'.repeat(2001) }).success).toBe(false)
    const ok = errorNotesSchema.safeParse({ id, notes: 'Slack の一時障害。再発なし' })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.notes).toBe('Slack の一時障害。再発なし')
  })
})
