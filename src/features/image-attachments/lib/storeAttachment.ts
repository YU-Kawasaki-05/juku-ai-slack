/** @file
 * 機能: ダウンロード済み画像を Supabase Storage に保存し attachments にメタデータ記録
 * 入力: db, StoreParams
 * 出力: storagePath
 * 例外: Storage/DB 失敗は ImageProcessingFailedError（呼び出し側で握りつぶし継続）
 * 依存: Supabase Storage(attachments バケット), attachments テーブル
 * 副作用: Storage への put, attachments への insert
 * セキュリティ: person_id で名前空間分離。Service Role のみアクセス（非公開バケット）
 * @implements FR-06, BR-06-05, BR-06-07, AC-06-01
 */
import type { ServerDb } from '@shared/types/db'
import { ATTACHMENTS_BUCKET } from '@shared/lib/constants'
import { ImageProcessingFailedError } from '@shared/lib/errors/AppError'
import { extFromMimetype } from './validateAttachment'

export interface StoreParams {
  personId: string
  channelId: string
  threadTs: string
  messageTs: string
  slackFileId: string
  mimetype: string
  originalName: string | null
  bytes: Uint8Array
  now?: Date
}

export async function storeAttachment(db: ServerDb, params: StoreParams): Promise<string> {
  const now = params.now ?? new Date()
  const ext = extFromMimetype(params.mimetype)
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const storagePath = `${params.personId}/${year}/${month}/${params.slackFileId}.${ext}`

  const { error: uploadError } = await db.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(storagePath, params.bytes, { contentType: params.mimetype, upsert: true })
  if (uploadError) throw new ImageProcessingFailedError(uploadError)

  // ジョブ再試行時の二重挿入を避けるため slack_file_id で upsert（BR-06。冪等）
  const { error: insertError } = await db.from('attachments').upsert(
    {
      slack_file_id: params.slackFileId,
      slack_channel_id: params.channelId,
      thread_ts: params.threadTs,
      message_ts: params.messageTs,
      person_id: params.personId,
      file_type: ext,
      mime_type: params.mimetype,
      original_name: params.originalName,
      storage_path: storagePath,
      file_size: params.bytes.byteLength,
      status: 'stored',
    },
    { onConflict: 'slack_file_id' },
  )
  if (insertError) throw new ImageProcessingFailedError(insertError)

  return storagePath
}
