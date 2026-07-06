/** @file
 * 機能: 添付画像のバリデーション（MIME・サイズ）純粋関数
 * 入力: { mimetype, size }
 * 出力: { ok } | { ok:false, reason }
 * 例外: なし
 * 依存: 定数
 * @implements FR-06, BR-06-01, BR-06-03, AC-06-02
 */
import { SUPPORTED_IMAGE_MIMETYPES, MAX_IMAGE_BYTES } from '@shared/lib/constants'

export type AttachmentRejectReason = 'unsupported_type' | 'too_large'

export interface ValidateAttachmentInput {
  mimetype: string | undefined
  size: number | undefined
}

export type ValidateAttachmentResult =
  | { ok: true }
  | { ok: false; reason: AttachmentRejectReason }

export function validateAttachment(input: ValidateAttachmentInput): ValidateAttachmentResult {
  const supported = SUPPORTED_IMAGE_MIMETYPES as readonly string[]
  if (!input.mimetype || !supported.includes(input.mimetype)) {
    return { ok: false, reason: 'unsupported_type' }
  }
  if (typeof input.size === 'number' && input.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'too_large' }
  }
  return { ok: true }
}

/** 拡張子を MIME から得る（ストレージパス用） */
export function extFromMimetype(mimetype: string): string {
  switch (mimetype) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return 'bin'
  }
}
