export { validateAttachment, extFromMimetype } from './lib/validateAttachment'
export type { ValidateAttachmentResult, AttachmentRejectReason } from './lib/validateAttachment'
export { downloadSlackFile, toDataUrl } from './lib/downloadSlackFile'
export type { DownloadedFile } from './lib/downloadSlackFile'
export { stripImageMetadata } from './lib/stripImageMetadata'
export type { StripImageMetadataResult } from './lib/stripImageMetadata'
export { storeAttachment } from './lib/storeAttachment'
export { processAttachments } from './lib/processAttachments'
export type {
  ProcessAttachmentsResult,
  ProcessAttachmentsParams,
  AttachmentInput,
} from './lib/processAttachments'
