/** @file
 * 検証: 生徒入力バリデーション
 * @verifies AC-14-02
 */
import { describe, it, expect } from 'vitest'
import { personCreateSchema } from './personSchema'

describe('personCreateSchema', () => {
  it('name 必須・任意項目は空文字を null 正規化', () => {
    const r = personCreateSchema.safeParse({ name: '太郎', displayName: '', grade: '', guardianEmail: '' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.name).toBe('太郎')
      expect(r.data.displayName).toBeNull()
      expect(r.data.grade).toBeNull()
      expect(r.data.guardianEmail).toBeNull()
      expect(r.data.status).toBe('active') // default
    }
  })

  it('name 空はエラー', () => {
    expect(personCreateSchema.safeParse({ name: '  ' }).success).toBe(false)
  })

  it('guardianEmail は入力時に形式検証', () => {
    expect(personCreateSchema.safeParse({ name: 'x', guardianEmail: 'not-email' }).success).toBe(false)
    const ok = personCreateSchema.safeParse({ name: 'x', guardianEmail: 'a@b.com' })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.guardianEmail).toBe('a@b.com')
  })

  it('status は active/inactive のみ', () => {
    expect(personCreateSchema.safeParse({ name: 'x', status: 'banned' }).success).toBe(false)
  })
})
