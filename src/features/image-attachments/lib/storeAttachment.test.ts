/** @file
 * 検証: Storage 保存パス（JST 年月）と DB 失敗時の巻き戻し（孤児ファイル防止）
 * @verifies FR-06, BR-06-05, BR-06-07
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ServerDb } from '@shared/types/db'
import { storeAttachment } from './storeAttachment'

interface DbOptions {
  uploadError?: { message: string } | null
  upsertError?: { message: string } | null
  removeError?: { message: string } | null
  removeThrows?: boolean
}

function createDb(options: DbOptions = {}) {
  const upload = vi.fn(async () => ({ error: options.uploadError ?? null }))
  const remove = vi.fn(async () => {
    if (options.removeThrows) throw new Error('network down')
    return { error: options.removeError ?? null }
  })
  const upsert = vi.fn(async () => ({ error: options.upsertError ?? null }))

  const db = {
    storage: { from: vi.fn(() => ({ upload, remove })) },
    from: vi.fn(() => ({ upsert })),
  }
  return { db: db as unknown as ServerDb, upload, remove, upsert }
}

const params = {
  personId: 'p1',
  channelId: 'C1',
  threadTs: '111.1',
  messageTs: '111.2',
  slackFileId: 'F1',
  mimetype: 'image/png',
  originalName: 'a.png',
  bytes: new Uint8Array([1, 2, 3]),
}

beforeEach(() => vi.restoreAllMocks())

describe('storeAttachment', () => {
  it('保存パスの年月は JST 基準（UTC 前日深夜でも JST の月に入る）', async () => {
    const { db } = createDb()
    // 2026-06-30 23:00 UTC = 2026-07-01 08:00 JST → 7月フォルダ
    const path = await storeAttachment(db, { ...params, now: new Date('2026-06-30T23:00:00Z') })
    expect(path).toBe('p1/2026/07/F1.png')
  })

  it('JST 昼の時刻はそのままの年月', async () => {
    const { db } = createDb()
    const path = await storeAttachment(db, { ...params, now: new Date('2026-07-15T03:00:00Z') })
    expect(path).toBe('p1/2026/07/F1.png')
  })

  it('年跨ぎも JST 基準（UTC 12/31 深夜 → JST 翌年1月）', async () => {
    const { db } = createDb()
    const path = await storeAttachment(db, { ...params, now: new Date('2026-12-31T20:00:00Z') })
    expect(path).toBe('p1/2027/01/F1.png')
  })

  it('DB upsert 失敗時は upload 済みファイルを remove で巻き戻す（孤児防止）', async () => {
    const { db, remove } = createDb({ upsertError: { message: 'insert failed' } })
    await expect(storeAttachment(db, { ...params, now: new Date('2026-07-15T03:00:00Z') })).rejects.toMatchObject({
      code: 'IMAGE_PROCESSING_FAILED',
    })
    expect(remove).toHaveBeenCalledWith(['p1/2026/07/F1.png'])
  })

  it('巻き戻しの remove 失敗はログのみで元エラーを隠さない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db } = createDb({ upsertError: { message: 'insert failed' }, removeError: { message: 'no such key' } })
    await expect(storeAttachment(db, params)).rejects.toMatchObject({ code: 'IMAGE_PROCESSING_FAILED' })
    expect(warn).toHaveBeenCalled()
  })

  it('remove が throw しても元エラーを伝播する', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db } = createDb({ upsertError: { message: 'insert failed' }, removeThrows: true })
    await expect(storeAttachment(db, params)).rejects.toMatchObject({ code: 'IMAGE_PROCESSING_FAILED' })
  })

  it('upload 失敗時は remove を呼ばない（消すものがない）', async () => {
    const { db, remove } = createDb({ uploadError: { message: 'quota' } })
    await expect(storeAttachment(db, params)).rejects.toMatchObject({ code: 'IMAGE_PROCESSING_FAILED' })
    expect(remove).not.toHaveBeenCalled()
  })

  it('成功時は remove を呼ばず storagePath を返す', async () => {
    const { db, remove, upsert } = createDb()
    const path = await storeAttachment(db, params)
    expect(path).toContain('p1/')
    expect(upsert).toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})
