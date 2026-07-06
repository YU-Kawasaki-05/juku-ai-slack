/** @file
 * 機能: payload の添付画像を検証→DL→保存し、Vision 用 data URL を収集する
 * 入力: db, ProcessAttachmentsParams, deps（テスト用に download/store を注入可）
 * 出力: { dataUrls, errorCodes }
 * 例外: なし（各画像の失敗はエラーコードとして収集し、処理は継続）
 * 依存: validateAttachment, downloadSlackFile, storeAttachment
 * 副作用: Slack GET, Storage put, attachments insert
 * セキュリティ: person_id は payload（channel 解決済み）のみ
 * @implements FR-06, AC-06-01, AC-06-03, AC-06-04, BR-06-02, BR-06-03
 */
import type { ServerDb } from '@shared/types/db'
import { ImageTooLargeError } from '@shared/lib/errors/AppError'
import { validateAttachment } from './validateAttachment'
import { downloadSlackFile, toDataUrl, type DownloadedFile } from './downloadSlackFile'
import { storeAttachment } from './storeAttachment'

export interface AttachmentInput {
  id: string
  name: string | null
  mimetype: string
  size: number | null
  urlPrivate: string
}

export interface ProcessAttachmentsParams {
  personId: string
  channelId: string
  threadTs: string
  messageTs: string
  botToken: string
  files: AttachmentInput[]
}

export interface ProcessAttachmentsResult {
  /** Vision に渡す data URL（保存に成功したもののみ） */
  dataUrls: string[]
  /** 発生したエラーコード（IMAGE_TOO_LARGE / SLACK_FILE_DOWNLOAD_FAILED / IMAGE_PROCESSING_FAILED） */
  errorCodes: string[]
}

export interface ProcessAttachmentsDeps {
  download?: (urlPrivate: string, botToken: string) => Promise<DownloadedFile>
  store?: typeof storeAttachment
}

export async function processAttachments(
  db: ServerDb,
  params: ProcessAttachmentsParams,
  deps: ProcessAttachmentsDeps = {},
): Promise<ProcessAttachmentsResult> {
  const download = deps.download ?? downloadSlackFile
  const store = deps.store ?? storeAttachment

  const dataUrls: string[] = []
  const errorCodes: string[] = []

  for (const file of params.files) {
    const valid = validateAttachment({ mimetype: file.mimetype, size: file.size ?? undefined })
    if (!valid.ok) {
      // route で MIME は絞り済みのため、実質サイズ超過のみ
      errorCodes.push(valid.reason === 'too_large' ? 'IMAGE_TOO_LARGE' : 'UNSUPPORTED_FILE_TYPE')
      continue
    }

    let downloaded: DownloadedFile
    try {
      downloaded = await download(file.urlPrivate, params.botToken)
    } catch (err) {
      // DL 時にサイズ超過を検出した場合は too_large として区別
      errorCodes.push(err instanceof ImageTooLargeError ? 'IMAGE_TOO_LARGE' : 'SLACK_FILE_DOWNLOAD_FAILED')
      continue
    }

    try {
      await store(db, {
        personId: params.personId,
        channelId: params.channelId,
        threadTs: params.threadTs,
        messageTs: params.messageTs,
        slackFileId: file.id,
        mimetype: file.mimetype,
        originalName: file.name,
        bytes: downloaded.bytes,
      })
    } catch {
      // BR: 保存失敗はテキストのみで継続（この画像は Vision に渡さない）
      errorCodes.push('IMAGE_PROCESSING_FAILED')
      continue
    }

    dataUrls.push(toDataUrl(downloaded.bytes, file.mimetype))
  }

  return { dataUrls, errorCodes }
}
