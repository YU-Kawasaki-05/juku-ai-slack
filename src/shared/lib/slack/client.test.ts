/** @file
 * 検証: Slack Web API クライアントの HTTP 境界（ステータス・content-type・JSON 破損・タイムアウト）と
 *   リアクション失敗の可視化
 * @verifies FR-05, FR-01, AC-01-06
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { postMessage, addReaction, removeReaction } from './client'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

/** fetch のレスポンスを差し替える（既定は Slack の正常 JSON 応答） */
function mockFetch(res: Partial<Response> & { json?: () => Promise<unknown> } = {}) {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
    json: async () => ({ ok: true, ts: '1700000000.000100' }),
    ...res,
  }))
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

/** fetch 自体が throw するケース（タイムアウト・ネットワーク障害） */
function mockFetchThrows(err: Error) {
  const fn = vi.fn(async () => {
    throw err
  })
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

describe('postMessage', () => {
  it('正常応答は ts を返す', async () => {
    mockFetch()
    await expect(postMessage({ channel: 'C1', text: 'hi' })).resolves.toEqual({
      ts: '1700000000.000100',
    })
  })

  it('5xx + HTML 本文は SlackPostFailedError（SyntaxError を漏らさない）', async () => {
    mockFetch({
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    })
    await expect(postMessage({ channel: 'C1', text: 'hi' })).rejects.toMatchObject({
      code: 'SLACK_POST_FAILED',
      cause: expect.stringContaining('http_502'),
    })
  })

  it('200 でも JSON 以外の content-type は SlackPostFailedError', async () => {
    mockFetch({ headers: new Headers({ 'content-type': 'text/html' }) })
    await expect(postMessage({ channel: 'C1', text: 'hi' })).rejects.toMatchObject({
      code: 'SLACK_POST_FAILED',
      cause: expect.stringContaining('unexpected_content_type'),
    })
  })

  it('JSON パース失敗は SlackPostFailedError', async () => {
    mockFetch({
      json: async () => {
        throw new SyntaxError('broken')
      },
    })
    await expect(postMessage({ channel: 'C1', text: 'hi' })).rejects.toMatchObject({
      code: 'SLACK_POST_FAILED',
      cause: expect.stringContaining('invalid_json_response'),
    })
  })

  it('タイムアウトは SlackPostFailedError に正規化される', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    mockFetchThrows(timeout)
    await expect(postMessage({ channel: 'C1', text: 'hi' })).rejects.toMatchObject({
      code: 'SLACK_POST_FAILED',
      cause: expect.stringContaining('http_timeout'),
    })
  })

  it('ネットワーク障害も SlackPostFailedError に正規化される', async () => {
    mockFetchThrows(new TypeError('fetch failed'))
    await expect(postMessage({ channel: 'C1', text: 'hi' })).rejects.toMatchObject({
      code: 'SLACK_POST_FAILED',
      cause: expect.stringContaining('http_request_failed'),
    })
  })

  it('Slack API の ok:false は従来どおり SlackPostFailedError', async () => {
    mockFetch({ json: async () => ({ ok: false, error: 'channel_not_found' }) })
    await expect(postMessage({ channel: 'C1', text: 'hi' })).rejects.toMatchObject({
      code: 'SLACK_POST_FAILED',
      cause: expect.stringContaining('channel_not_found'),
    })
  })

  it('fetch にタイムアウト用の AbortSignal を渡す', async () => {
    const fn = mockFetch()
    await postMessage({ channel: 'C1', text: 'hi' })
    const init = (fn.mock.calls[0] as unknown[])[1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('reactions', () => {
  it('addReaction は例外を投げず結果を返す（HTTP 失敗でも）', async () => {
    mockFetch({ ok: false, status: 500, headers: new Headers({ 'content-type': 'text/html' }) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await addReaction({ channel: 'C1', timestamp: 't', name: 'thinking_face' })
    expect(r.ok).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('already_reacted はログを出さない（想定内）', async () => {
    mockFetch({ json: async () => ({ ok: false, error: 'already_reacted' }) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await addReaction({ channel: 'C1', timestamp: 't', name: 'thinking_face' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('missing_scope など構成ミスは console.warn に出す', async () => {
    mockFetch({ json: async () => ({ ok: false, error: 'missing_scope' }) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await addReaction({ channel: 'C1', timestamp: 't', name: 'thinking_face' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing_scope'))
  })

  it('removeReaction の no_reaction はログを出さない', async () => {
    mockFetch({ json: async () => ({ ok: false, error: 'no_reaction' }) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await removeReaction({ channel: 'C1', timestamp: 't', name: 'thinking_face' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('429 は Retry-After をログに残し ratelimited を返す', async () => {
    mockFetch({
      ok: false,
      status: 429,
      headers: new Headers({ 'content-type': 'application/json', 'retry-after': '30' }),
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await addReaction({ channel: 'C1', timestamp: 't', name: 'thinking_face' })
    expect(r).toMatchObject({ ok: false, error: 'ratelimited' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('retry-after=30'))
  })
})
