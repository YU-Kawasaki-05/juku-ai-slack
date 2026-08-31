/** @file
 * 検証: 画像処理オーケストレーション（DL→保存→data URL、エラー収集）
 * @verifies FR-06, AC-06-01, AC-06-03, BR-06-03
 */
import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import { processAttachments, type AttachmentInput } from './processAttachments'
import { MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, MAX_IMAGE_LONG_EDGE } from '@shared/lib/constants'

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

  it('長辺が上限超の画像は縮小してから保存・送信する（原本は保存しない）', async () => {
    const raw = await realJpeg(3000, 2000)
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

    expect(r.resizedCount).toBe(1)
    // Storage には原本ではなく縮小後を保存する（LLM に送ったものと同じバイト列）
    expect((await sharp(raw).metadata()).width).toBe(3000)
    expect((await sharp(storedBytes).metadata()).width).toBe(MAX_IMAGE_LONG_EDGE)
    expect(Buffer.from(storedBytes).equals(Buffer.from(raw))).toBe(false)
    const decoded = Buffer.from(r.dataUrls[0].split(',')[1], 'base64')
    expect(decoded.equals(Buffer.from(storedBytes))).toBe(true)
  })

  it('長辺が上限以下の画像は 1 バイトも変えずに保存・送信する', async () => {
    const raw = await realJpeg(1600, 1200)
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

    expect(r.resizedCount).toBe(0)
    expect(r.metadataStrippedBytes).toBe(0)
    expect(Buffer.from(storedBytes).equals(Buffer.from(raw))).toBe(true)
  })

  it('縮小経路でも EXIF/GPS は残らない（Storage・Vision の両方）', async () => {
    const raw = await realJpeg(3000, 2000, {
      IFD0: { Make: 'Apple', Model: 'iPhone-SECRET-MODEL' },
      // sharp は IFD3 を GPSInfo にマップする
      IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E', GPSLatitude: '35/1 40/1 52/1' },
    })
    expect(Buffer.from(raw).toString('latin1')).toContain('iPhone-SECRET-MODEL')
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

    expect(r.resizedCount).toBe(1)
    expect((await sharp(storedBytes).metadata()).exif).toBeUndefined()
    expect(Buffer.from(storedBytes).toString('latin1')).not.toContain('iPhone-SECRET-MODEL')
    const decoded = Buffer.from(r.dataUrls[0].split(',')[1], 'base64')
    expect(decoded.toString('latin1')).not.toContain('iPhone-SECRET-MODEL')
  })

  it('合計上限の判定は縮小後のバイト数で行う（原寸なら 2 枚目が落ちるケース）', async () => {
    // 原寸では 2 枚で 8MB を超えるが、長辺キャップ後なら 2 枚とも収まる
    const raw = padJpeg(await realJpeg(3000, 2000), 4_200_000)
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

    expect(r.resizedCount).toBe(2)
    expect(r.dataUrls).toHaveLength(2)
    expect(r.skippedForTotalSize).toBe(0)
    expect(r.errorCodes).toEqual([])
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

/** 実際にデコードできる JPEG を作る（縮小経路のテスト用）。exif を渡すと EXIF 付きになる */
async function realJpeg(
  width: number,
  height: number,
  exif?: Parameters<ReturnType<typeof sharp>['withExif']>[0],
): Promise<Uint8Array> {
  const channels = 3
  const raw = Buffer.alloc(width * height * channels)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels
      // 写真に近い低周波の絵柄（高周波ノイズだと縮小後の方が重くなり、実際の傾向とずれる）
      const block = ((x >> 6) ^ (y >> 6)) & 1
      raw[i] = Math.round((x / width) * 255)
      raw[i + 1] = Math.round((y / height) * 255)
      raw[i + 2] = block ? 210 : 45
    }
  }
  let pipeline = sharp(raw, { raw: { width, height, channels } })
  if (exif) pipeline = pipeline.withExif(exif)
  return new Uint8Array(await pipeline.jpeg().toBuffer())
}

/**
 * デコード可能なまま JPEG のバイト数だけ膨らませる（SOI 直後に COM セグメントを詰める）。
 * 巨大な原寸写真を毎回エンコードすると遅いので、合計サイズ判定のテストではこれを使う。
 * JPEG のセグメント長は 16bit なので 65535 バイトずつに分ける。
 */
function padJpeg(bytes: Uint8Array, targetBytes: number): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)] // SOI
  let remaining = targetBytes - bytes.byteLength
  while (remaining > 4) {
    const payload = Math.min(remaining - 4, 65533)
    const segLen = payload + 2
    const seg = new Uint8Array(payload + 4)
    seg[0] = 0xff
    seg[1] = 0xfe // COM
    seg[2] = (segLen >> 8) & 0xff
    seg[3] = segLen & 0xff
    seg.fill(0x20, 4)
    parts.push(seg)
    remaining -= seg.byteLength
  }
  parts.push(bytes.subarray(2))
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.byteLength
  }
  return out
}
