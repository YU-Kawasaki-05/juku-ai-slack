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
