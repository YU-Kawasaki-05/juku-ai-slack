/** @file
 * 検証: 画像処理オーケストレーション（DL→保存→data URL、エラー収集）
 * @verifies FR-06, AC-06-01, AC-06-03, BR-06-03
 */
import { describe, it, expect, vi } from 'vitest'
import { processAttachments, type AttachmentInput } from './processAttachments'
import { MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES } from '@shared/lib/constants'

const db = {} as never
const png = (id: string, over: Partial<AttachmentInput> = {}): AttachmentInput => ({
  id,
  name: `${id}.png`,
  mimetype: 'image/png',
  size: 1000,
  urlPrivate: `https://slack/${id}`,
  ...over,
})

const okDownload = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }))
const okStore = vi.fn(async () => 'path')

describe('processAttachments', () => {
  it('対応画像を DL→保存し data URL を返す（AC-06-01）', async () => {
    const r = await processAttachments(
      db,
      { personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x', files: [png('F1')] },
      { download: okDownload, store: okStore },
    )
    expect(r.dataUrls).toHaveLength(1)
    expect(r.dataUrls[0]).toMatch(/^data:image\/png;base64,/)
    expect(r.errorCodes).toEqual([])
    expect(okStore).toHaveBeenCalled()
  })

  it('サイズ超過は IMAGE_TOO_LARGE でスキップ（BR-06-03）', async () => {
    const r = await processAttachments(
      db,
      {
        personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x',
        files: [png('F1', { size: MAX_IMAGE_BYTES + 1 })],
      },
      { download: okDownload, store: okStore },
    )
    expect(r.dataUrls).toEqual([])
    expect(r.errorCodes).toContain('IMAGE_TOO_LARGE')
  })

  it('ダウンロード失敗は SLACK_FILE_DOWNLOAD_FAILED でスキップ', async () => {
    const failDownload = vi.fn(async () => {
      throw new Error('dl fail')
    })
    const r = await processAttachments(
      db,
      { personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x', files: [png('F1')] },
      { download: failDownload, store: okStore },
    )
    expect(r.dataUrls).toEqual([])
    expect(r.errorCodes).toContain('SLACK_FILE_DOWNLOAD_FAILED')
  })

  it('保存失敗は IMAGE_PROCESSING_FAILED でスキップ（テキストのみ継続）', async () => {
    const failStore = vi.fn(async () => {
      throw new Error('store fail')
    })
    const r = await processAttachments(
      db,
      { personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x', files: [png('F1')] },
      { download: okDownload, store: failStore },
    )
    expect(r.dataUrls).toEqual([])
    expect(r.errorCodes).toContain('IMAGE_PROCESSING_FAILED')
  })

  it('成功と失敗が混在しても成功分だけ data URL を返す', async () => {
    const flaky = vi
      .fn()
      .mockResolvedValueOnce({ bytes: new Uint8Array([1]), contentType: 'image/png' })
      .mockRejectedValueOnce(new Error('dl fail'))
    const r = await processAttachments(
      db,
      { personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x', files: [png('F1'), png('F2')] },
      { download: flaky, store: okStore },
    )
    expect(r.dataUrls).toHaveLength(1)
    expect(r.errorCodes).toContain('SLACK_FILE_DOWNLOAD_FAILED')
  })

  it('実 content-type が非対応なら Slack 申告値が対応形式でもスキップ（C-7）', async () => {
    // Slack は image/png と申告するが実体は image/gif
    const gifDownload = vi.fn(async () => ({ bytes: new Uint8Array([1]), contentType: 'image/gif' }))
    const store = vi.fn(async () => 'path')
    const r = await processAttachments(
      db,
      { personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x', files: [png('F1')] },
      { download: gifDownload, store },
    )
    expect(r.dataUrls).toEqual([])
    expect(r.errorCodes).toContain('UNSUPPORTED_FILE_TYPE')
    expect(store).not.toHaveBeenCalled()
  })

  it('data URL と保存の mimetype は実 content-type を採用する（C-7）', async () => {
    // Slack 申告は image/png だが実体は image/jpeg（パラメータ付き）
    const jpegDownload = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      contentType: 'image/jpeg; charset=binary',
    }))
    const store = vi.fn(async () => 'path')
    const r = await processAttachments(
      db,
      { personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x', files: [png('F1')] },
      { download: jpegDownload, store },
    )
    expect(r.dataUrls[0]).toMatch(/^data:image\/jpeg;base64,/)
    expect(store).toHaveBeenCalledWith(db, expect.objectContaining({ mimetype: 'image/jpeg' }))
  })

  it('合計サイズ上限を超えた画像はスキップし skippedForTotalSize で伝える（C-4）', async () => {
    const half = new Uint8Array(Math.ceil(MAX_TOTAL_IMAGE_BYTES * 0.6))
    const bigDownload = vi.fn(async () => ({ bytes: half, contentType: 'image/png' }))
    const store = vi.fn(async () => 'path')
    const r = await processAttachments(
      db,
      {
        personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x',
        files: [png('F1'), png('F2')],
      },
      { download: bigDownload, store },
    )
    // 1枚目は通り、2枚目で合計 8MB を超えるためスキップ
    expect(r.dataUrls).toHaveLength(1)
    expect(r.skippedForTotalSize).toBe(1)
    expect(r.errorCodes).toContain('IMAGE_TOO_LARGE')
    expect(store).toHaveBeenCalledTimes(1)
  })

  it('合計上限の判定はメタデータ除去後のバイト数で行う（EXIF 分を枚数に活かす）', async () => {
    // 生バイトでは 2 枚で 8MB を超えるが、EXIF を落とすと収まるサイズにする
    const raw = jpegWithExif(4_200_000, 65_000)
    expect(raw.byteLength * 2).toBeGreaterThan(MAX_TOTAL_IMAGE_BYTES)
    const download = vi.fn(async () => ({ bytes: raw, contentType: 'image/jpeg' }))
    const store = vi.fn(async () => 'path')
    const r = await processAttachments(
      db,
      {
        personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x',
        files: [png('F1'), png('F2')],
      },
      { download, store },
    )
    expect(r.dataUrls).toHaveLength(2)
    expect(r.skippedForTotalSize).toBe(0)
    expect(r.errorCodes).toEqual([])
    expect(r.metadataStrippedBytes).toBe(65_004 * 2)
  })

  it('Storage 保存にも Vision 送信にもメタデータ除去後のバイト列を渡す', async () => {
    const raw = jpegWithExif(4_000, 200)
    const download = vi.fn(async () => ({ bytes: raw, contentType: 'image/jpeg' }))
    let storedBytes: Uint8Array = new Uint8Array(0)
    const store = vi.fn(async (_db: unknown, p: { bytes: Uint8Array }) => {
      storedBytes = p.bytes
      return 'path'
    })
    const r = await processAttachments(
      db,
      { personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x', files: [png('F1')] },
      { download, store },
    )
    expect(storedBytes.byteLength).toBe(raw.byteLength - 204)
    expect(Buffer.from(storedBytes).toString('latin1')).not.toContain('GPSLatitude')
    // data URL 側も同じ（除去後）バイト列
    const decoded = Buffer.from(r.dataUrls[0].split(',')[1], 'base64')
    expect(decoded.toString('latin1')).not.toContain('GPSLatitude')
    expect(decoded.byteLength).toBe(storedBytes.byteLength)
  })

  it('メタデータが無い画像では metadataStrippedBytes が 0', async () => {
    const r = await processAttachments(
      db,
      { personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x', files: [png('F1')] },
      { download: okDownload, store: okStore },
    )
    expect(r.metadataStrippedBytes).toBe(0)
  })

  it('合計が上限以内なら全枚数を通す（skippedForTotalSize=0）', async () => {
    const r = await processAttachments(
      db,
      {
        personId: 'p1', channelId: 'C1', threadTs: 't', messageTs: 'm', botToken: 'x',
        files: [png('F1'), png('F2'), png('F3')],
      },
      { download: okDownload, store: okStore },
    )
    expect(r.dataUrls).toHaveLength(3)
    expect(r.skippedForTotalSize).toBe(0)
    expect(r.errorCodes).toEqual([])
  })
})

/**
 * 合計 totalBytes の JPEG を組み立てる。APP1(EXIF) は exifPayload バイト分、
 * 残りは SOS 以降のダミースキャンデータ（= ピクセル領域）で埋める。
 */
function jpegWithExif(totalBytes: number, exifPayload: number): Uint8Array {
  const exifSegLen = exifPayload + 2 // 長さフィールド 2 バイトを含む
  const sosHeader = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]
  const scanLen = totalBytes - (2 + 2 + exifSegLen + sosHeader.length + 2)
  if (scanLen < 0) throw new Error('totalBytes too small')

  const out = new Uint8Array(totalBytes)
  let i = 0
  out[i++] = 0xff
  out[i++] = 0xd8 // SOI
  out[i++] = 0xff
  out[i++] = 0xe1 // APP1
  out[i++] = (exifSegLen >> 8) & 0xff
  out[i++] = exifSegLen & 0xff
  const marker = 'Exif\0\0II*\0GPSLatitude 35.6812'
  for (const ch of marker) out[i++] = ch.charCodeAt(0)
  i += exifPayload - marker.length // 残りは 0 埋め
  for (const b of sosHeader) out[i++] = b
  out.fill(0x5a, i, i + scanLen)
  i += scanLen
  out[i++] = 0xff
  out[i++] = 0xd9 // EOI
  return out
}
