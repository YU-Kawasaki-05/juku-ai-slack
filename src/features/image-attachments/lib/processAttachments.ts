/** @file
 * 機能: payload の添付画像を検証→DL→長辺キャップ／メタデータ除去→保存し、Vision 用 data URL を収集する
 *   MIME は Slack 申告値ではなく実際の content-type で判定し、合計バイト上限を超えた分はスキップする
 * 入力: db, ProcessAttachmentsParams, deps（テスト用に download/store を注入可）
 * 出力: { dataUrls, errorCodes, skippedForTotalSize, metadataStrippedBytes, resizedCount }
 * 例外: なし（各画像の失敗はエラーコードとして収集し、処理は継続）
 * 依存: validateAttachment, downloadSlackFile, resizeImage, stripImageMetadata, storeAttachment
 * 副作用: Slack GET, Storage put, attachments insert
 * セキュリティ: person_id は payload（channel 解決済み）のみ。
 *   EXIF/GPS は Storage 保存前・LLM 送信前の同一バイト列から落とす（両経路で漏れない）。
 *   縮小した画像は sharp の再エンコードでメタデータごと消え、縮小しなかった画像は
 *   stripImageMetadata が落とす（どちらの経路でも残らない）
 * @implements FR-06, AC-06-01, AC-06-03, AC-06-04, BR-06-02, BR-06-03, BR-06-05
 */
import type { ServerDb } from '@shared/types/db'
import { MAX_TOTAL_IMAGE_BYTES, SUPPORTED_IMAGE_MIMETYPES } from '@shared/lib/constants'
import { ImageTooLargeError } from '@shared/lib/errors/AppError'
import { validateAttachment } from './validateAttachment'
import { downloadSlackFile, toDataUrl, type DownloadedFile } from './downloadSlackFile'
import { resizeImage } from './resizeImage'
import { stripImageMetadata } from './stripImageMetadata'
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
  /** 発生したエラーコード（IMAGE_TOO_LARGE / UNSUPPORTED_FILE_TYPE / SLACK_FILE_DOWNLOAD_FAILED / IMAGE_PROCESSING_FAILED） */
  errorCodes: string[]
  /** 合計バイト上限（MAX_TOTAL_IMAGE_BYTES）超過でスキップした枚数 */
  skippedForTotalSize: number
  /** メタデータ除去で削減できた合計バイト数（0 なら除去対象なし。削減効果の観測用） */
  metadataStrippedBytes: number
  /** 長辺が上限を超えていて縮小した枚数（トークン削減効果の観測用） */
  resizedCount: number
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
  let skippedForTotalSize = 0
  let totalBytes = 0
  let metadataStrippedBytes = 0
  let resizedCount = 0

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

    // Slack 申告の mimetype は信用せず、実際に返ってきた content-type で判定する
    const actualMimetype = normalizeMimetype(downloaded.contentType)
    if (!(SUPPORTED_IMAGE_MIMETYPES as readonly string[]).includes(actualMimetype)) {
      errorCodes.push('UNSUPPORTED_FILE_TYPE')
      continue
    }

    // 長辺キャップ。Vision のトークン数は解像度に比例するので、送る前にここで天井を作る
    const resized = await resizeImage(downloaded.bytes, actualMimetype)
    let bytes: Uint8Array
    if (resized.resized) {
      // sharp の再エンコードは入力のメタデータを引き継がない＝EXIF/GPS はこの時点で消えている。
      // ここに stripImageMetadata を重ねても落とすものが無いので通さない
      resizedCount += 1
      bytes = resized.bytes
    } else {
      // 上限以下（＝1 バイトも変わっていない原本）。EXIF/GPS はバイト列レベルで落とす
      const stripped = stripImageMetadata(resized.bytes, actualMimetype)
      metadataStrippedBytes += stripped.removedBytes
      bytes = stripped.bytes
    }

    // 合計サイズ上限（枚数上限だけでは Vision API の受付上限を超える）。超過分はスキップ
    // 判定は縮小・除去後のバイト数で行う（削減分を枚数に活かす）
    if (totalBytes + bytes.byteLength > MAX_TOTAL_IMAGE_BYTES) {
      skippedForTotalSize += 1
      errorCodes.push('IMAGE_TOO_LARGE')
      continue
    }

    try {
      await store(db, {
        personId: params.personId,
        channelId: params.channelId,
        threadTs: params.threadTs,
        messageTs: params.messageTs,
        slackFileId: file.id,
        mimetype: actualMimetype,
        originalName: file.name,
        bytes,
      })
    } catch {
      // BR: 保存失敗はテキストのみで継続（この画像は Vision に渡さない）
      errorCodes.push('IMAGE_PROCESSING_FAILED')
      continue
    }

    totalBytes += bytes.byteLength
    dataUrls.push(toDataUrl(bytes, actualMimetype))
  }

  return { dataUrls, errorCodes, skippedForTotalSize, metadataStrippedBytes, resizedCount }
}

/** 'image/png; charset=binary' → 'image/png'（パラメータを落とし小文字化） */
function normalizeMimetype(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase()
}
