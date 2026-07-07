/** @file
 * 検証: レポート入力バリデーション
 * @verifies AC-16-01
 */
import { describe, it, expect } from 'vitest'
import { reportCreateSchema, reportUpdateSchema } from './reportSchema'

const base = {
  personId: '11111111-1111-4111-8111-111111111111',
  title: '6月レポート',
  reportMonth: '2026-06',
  bodyMarkdown: '# 内容',
  isAiReference: true,
  status: 'draft',
}

describe('reportCreateSchema', () => {
  it('対象月 YYYY-MM を月初日 DATE に正規化する', () => {
    const r = reportCreateSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.reportMonth).toBe('2026-06-01')
  })

  it('不正な月・存在しない月はエラー', () => {
    expect(reportCreateSchema.safeParse({ ...base, reportMonth: '2026-13' }).success).toBe(false)
    expect(reportCreateSchema.safeParse({ ...base, reportMonth: '2026/06' }).success).toBe(false)
    expect(reportCreateSchema.safeParse({ ...base, reportMonth: '' }).success).toBe(false)
  })

  it('タイトルは必須・200文字以内', () => {
    expect(reportCreateSchema.safeParse({ ...base, title: '  ' }).success).toBe(false)
    expect(reportCreateSchema.safeParse({ ...base, title: 'あ'.repeat(201) }).success).toBe(false)
    expect(reportCreateSchema.safeParse({ ...base, title: 'あ'.repeat(200) }).success).toBe(true)
  })

  it('本文の空文字は null に正規化', () => {
    const r = reportCreateSchema.safeParse({ ...base, bodyMarkdown: '  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.bodyMarkdown).toBeNull()
  })

  it('status はフォームから draft/approved のみ受け付ける（ai_draft/sent はシステム専用）', () => {
    expect(reportCreateSchema.safeParse({ ...base, status: 'approved' }).success).toBe(true)
    expect(reportCreateSchema.safeParse({ ...base, status: 'ai_draft' }).success).toBe(false)
    expect(reportCreateSchema.safeParse({ ...base, status: 'sent' }).success).toBe(false)
    expect(reportCreateSchema.safeParse({ ...base, status: 'published' }).success).toBe(false)
  })

  it('personId は UUID 必須', () => {
    expect(reportCreateSchema.safeParse({ ...base, personId: 'abc' }).success).toBe(false)
  })
})

describe('reportUpdateSchema', () => {
  it('id 必須。生徒・対象月は受け付けない（変更不可）', () => {
    const r = reportUpdateSchema.safeParse({
      id: '22222222-2222-4222-8222-222222222222',
      title: 'x',
      bodyMarkdown: '',
      isAiReference: false,
      status: 'approved',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect('personId' in r.data).toBe(false)
      expect('reportMonth' in r.data).toBe(false)
    }
  })
})
