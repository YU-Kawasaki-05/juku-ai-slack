/** @file
 * 検証: Slack 画像ダウンロードのホスト検証・リダイレクト拒否・サイズ上限
 * @verifies FR-06, BR-06-03, BR-06-04（SSRF/トークン漏洩対策）
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadSlackFile, toDataUrl } from './downloadSlackFile'
import { MAX_IMAGE_BYTES } from '@shared/lib/constants'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

function mockFetch(res: Partial<Response> & { arrayBuffer?: () => Promise<ArrayBuffer> }) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    type: 'basic',
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    ...res,
  })) as unknown as typeof fetch
}

describe('downloadSlackFile', () => {
  it('slack.com 以外のホストは Bot token を送らず失敗（SSRF/漏洩対策）', async () => {
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    await expect(downloadSlackFile('https://evil.example.com/x', 'xoxb-secret')).rejects.toMatchObject({
      code: 'SLACK_FILE_DOWNLOAD_FAILED',
    })
    expect(spy).not.toHaveBeenCalled() // トークンを外部に送っていない
  })

  it('https 以外も拒否', async () => {
    await expect(downloadSlackFile('http://files.slack.com/x', 'x')).rejects.toBeTruthy()
  })

  it('files.slack.com は許可され bytes を返す', async () => {
    mockFetch({})
    const r = await downloadSlackFile('https://files.slack.com/f/1.png', 'xoxb')
    expect(r.bytes.byteLength).toBe(3)
    expect(r.contentType).toBe('image/png')
  })

  it('リダイレクト(3xx)は追従せず失敗', async () => {
    mockFetch({ status: 302 })
    await expect(downloadSlackFile('https://files.slack.com/x', 'x')).rejects.toMatchObject({
      code: 'SLACK_FILE_DOWNLOAD_FAILED',
    })
  })

  it('opaqueredirect も失敗', async () => {
    mockFetch({ type: 'opaqueredirect', status: 0 })
    await expect(downloadSlackFile('https://files.slack.com/x', 'x')).rejects.toBeTruthy()
  })

  it('画像でない content-type は失敗', async () => {
    mockFetch({ headers: new Headers({ 'content-type': 'text/html' }) })
    await expect(downloadSlackFile('https://files.slack.com/x', 'x')).rejects.toBeTruthy()
  })

  it('Content-Length が上限超過なら ImageTooLargeError', async () => {
    mockFetch({ headers: new Headers({ 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) }) })
    await expect(downloadSlackFile('https://files.slack.com/x', 'x')).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
    })
  })

  it('実バイト数が上限超過なら ImageTooLargeError（Content-Length 欠落時）', async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 10)
    mockFetch({ headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => big.buffer })
    await expect(downloadSlackFile('https://files.slack.com/x', 'x')).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
    })
  })
})

describe('toDataUrl', () => {
  it('base64 data URL を生成', () => {
    expect(toDataUrl(new Uint8Array([1, 2, 3]), 'image/png')).toBe('data:image/png;base64,AQID')
  })
})
