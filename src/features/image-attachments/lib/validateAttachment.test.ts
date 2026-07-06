/** @file
 * 検証: 添付画像のバリデーション
 * @verifies FR-06, AC-06-02, BR-06-01, BR-06-03
 */
import { describe, it, expect } from 'vitest'
import { validateAttachment, extFromMimetype } from './validateAttachment'
import { MAX_IMAGE_BYTES } from '@shared/lib/constants'

describe('validateAttachment', () => {
  it('対応MIME・サイズ内は ok', () => {
    expect(validateAttachment({ mimetype: 'image/png', size: 1000 })).toEqual({ ok: true })
    expect(validateAttachment({ mimetype: 'image/jpeg', size: 1000 }).ok).toBe(true)
    expect(validateAttachment({ mimetype: 'image/webp', size: 1000 }).ok).toBe(true)
  })

  it('対応外MIME は unsupported_type（AC-06-02）', () => {
    expect(validateAttachment({ mimetype: 'application/pdf', size: 1000 })).toEqual({
      ok: false,
      reason: 'unsupported_type',
    })
    expect(validateAttachment({ mimetype: undefined, size: 1000 }).ok).toBe(false)
  })

  it('サイズ超過は too_large（BR-06-03）', () => {
    expect(validateAttachment({ mimetype: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toEqual({
      ok: false,
      reason: 'too_large',
    })
  })
})

describe('extFromMimetype', () => {
  it('MIME から拡張子', () => {
    expect(extFromMimetype('image/jpeg')).toBe('jpg')
    expect(extFromMimetype('image/png')).toBe('png')
    expect(extFromMimetype('image/webp')).toBe('webp')
  })
})
