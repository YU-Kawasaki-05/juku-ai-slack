/** @file
 * 検証: Slack Webhook ルートのオーケストレーション（署名→検証→重複→反応制御→ジョブ登録）
 * @verifies AC-01-01, AC-01-02, AC-01-03, AC-01-04, AC-02-01, AC-02-02, AC-02-06
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

const mocks = vi.hoisted(() => ({
  recordEventReceipt: vi.fn(),
  deleteReceipt: vi.fn(),
  lookupBinding: vi.fn(),
  findSession: vi.fn(),
  enqueueJob: vi.fn(),
  processJob: vi.fn(),
  logError: vi.fn(),
  postMessage: vi.fn(),
  afterCbs: [] as Array<() => unknown>,
}))

vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: () => ({}) }))
vi.mock('@features/channel-bindings', () => ({ lookupBinding: mocks.lookupBinding }))
vi.mock('@features/thread-sessions', () => ({ findSession: mocks.findSession }))
vi.mock('@features/jobs', () => ({ enqueueJob: mocks.enqueueJob, processJob: mocks.processJob }))
vi.mock('@features/error-logs', () => ({ logError: mocks.logError }))
vi.mock('@shared/lib/slack/client', () => ({ postMessage: mocks.postMessage }))
vi.mock('@features/slack-events', async (importOriginal) => {
  const actual = (await importOriginal()) as object
  return { ...actual, recordEventReceipt: mocks.recordEventReceipt, deleteReceipt: mocks.deleteReceipt }
})
vi.mock('next/server', async (importOriginal) => {
  const actual = (await importOriginal()) as object
  return { ...actual, after: (cb: () => unknown) => mocks.afterCbs.push(cb) }
})

import { POST } from './route'

const SECRET = 'test-signing-secret'

function signedRequest(body: unknown, opts: { badSig?: boolean; ts?: number } = {}): Request {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000))
  const sig = opts.badSig
    ? 'v0=deadbeef'
    : `v0=${createHmac('sha256', SECRET).update(`v0:${ts}:${raw}`).digest('hex')}`
  return new Request('http://localhost/api/slack/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-signature': sig,
      'x-slack-request-timestamp': ts,
    },
    body: raw,
  })
}

async function flushAfter(): Promise<void> {
  for (const cb of mocks.afterCbs) await cb()
}

function messageEvent(over: Record<string, unknown> = {}) {
  return {
    type: 'event_callback',
    event_id: 'Ev1',
    team_id: 'T1',
    event: { type: 'message', channel: 'C1', user: 'U1', ts: '100.1', text: '<@U_BOT> 質問', ...over },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.afterCbs.length = 0
  mocks.recordEventReceipt.mockResolvedValue('new')
  mocks.lookupBinding.mockResolvedValue({
    status: 'active',
    binding: { person_id: 'p1', default_report_id: 'r1' },
  })
  mocks.findSession.mockResolvedValue(null)
  mocks.enqueueJob.mockResolvedValue('job1')
  mocks.processJob.mockResolvedValue({ status: 'completed' })
})

describe('POST /api/slack/events', () => {
  it('url_verification は challenge を返す（AC-01-01）', async () => {
    const res = await POST(signedRequest({ type: 'url_verification', challenge: 'xyz' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challenge: 'xyz' })
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
  })

  it('署名不正は 401、ジョブ登録なし、DB 書き込みもしない（AC-01-03）', async () => {
    const res = await POST(signedRequest(messageEvent(), { badSig: true }))
    expect(res.status).toBe(401)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
    // 未認証リクエストで DB 書き込みを誘発しない（セキュリティ: 増幅防止）
    expect(mocks.recordEventReceipt).not.toHaveBeenCalled()
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('タイムスタンプ超過は 401（AC-01-05）', async () => {
    const old = Math.floor(Date.now() / 1000) - 400
    const res = await POST(signedRequest(messageEvent(), { ts: old }))
    expect(res.status).toBe(401)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
  })

  it('メンションあり + active 紐付け → ジョブ登録して 200（AC-01-02, AC-02-01）', async () => {
    const res = await POST(signedRequest(messageEvent()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.enqueueJob).toHaveBeenCalledOnce()
    // person_id は binding から解決した値（クライアント値を信用しない）
    const payload = mocks.enqueueJob.mock.calls[0][1]
    expect(payload.personId).toBe('p1')
    expect(payload.channelId).toBe('C1')
    expect(payload.threadTs).toBe('100.1')
    // AC-04-01 / BR-01-04: ACK 前に AI 処理（processJob）を実行しない
    expect(mocks.processJob).not.toHaveBeenCalled()
    // ACK 後に processJob が予約される
    await flushAfter()
    expect(mocks.processJob).toHaveBeenCalledOnce()
  })

  it('重複イベントはジョブ登録せず SLACK_EVENT_DUPLICATE(info) を記録（AC-01-04）', async () => {
    mocks.recordEventReceipt.mockResolvedValue('duplicate')
    const res = await POST(signedRequest(messageEvent()))
    expect(res.status).toBe(200)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
    await flushAfter()
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'SLACK_EVENT_DUPLICATE', severity: 'info' }),
    )
  })

  it('不正な JSON は 400', async () => {
    const res = await POST(signedRequest('not-json-at-all'))
    expect(res.status).toBe(400)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
  })

  it('message 以外のイベントは 200 で無視', async () => {
    const res = await POST(
      signedRequest({
        type: 'event_callback',
        event_id: 'Ev2',
        team_id: 'T1',
        event: { type: 'reaction_added' },
      }),
    )
    expect(res.status).toBe(200)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
  })

  it('receipt 後の一過性エラーは receipt 削除 + 500（H-1）', async () => {
    mocks.lookupBinding.mockRejectedValue(new Error('transient DB error'))
    const res = await POST(signedRequest(messageEvent()))
    expect(res.status).toBe(500)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
    // receipt を削除して Slack 再送での再処理を可能にする
    expect(mocks.deleteReceipt).toHaveBeenCalledWith(expect.anything(), 'Ev1')
    expect(mocks.processJob).not.toHaveBeenCalled()
  })

  it('メンションなしのチャンネル直下は無視（AC-02-02）', async () => {
    const res = await POST(signedRequest(messageEvent({ text: 'メンションなしの雑談' })))
    expect(res.status).toBe(200)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
    expect(mocks.lookupBinding).not.toHaveBeenCalled() // DB も引かない
  })

  it('紐付けなしチャンネルは CHANNEL_NOT_BOUND を返信（AC-02-06）', async () => {
    mocks.lookupBinding.mockResolvedValue({ status: 'none', binding: null })
    const res = await POST(signedRequest(messageEvent()))
    expect(res.status).toBe(200)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
    await flushAfter()
    expect(mocks.postMessage).toHaveBeenCalledOnce()
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'CHANNEL_NOT_BOUND' }),
    )
  })

  it('Bot 自身のメッセージは無視（AC-02-05）', async () => {
    const res = await POST(signedRequest(messageEvent({ bot_id: 'B1' })))
    expect(res.status).toBe(200)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
  })

  it('対応外ファイルのみ+メンション（実質テキストなし）は UNSUPPORTED を返しジョブ登録しない（AC-06-02）', async () => {
    const res = await POST(
      signedRequest(
        messageEvent({
          subtype: 'file_share',
          text: '<@U_BOT>',
          files: [{ id: 'F1', mimetype: 'application/pdf', url_private: 'https://slack/F1', name: 'doc.pdf' }],
        }),
      ),
    )
    expect(res.status).toBe(200)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
    await flushAfter()
    expect(mocks.postMessage).toHaveBeenCalledOnce()
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'UNSUPPORTED_FILE_TYPE' }),
    )
  })

  it('画像添付(file_share)+メンションはジョブ登録し payload.files に対応画像を積む（FR-06）', async () => {
    const res = await POST(
      signedRequest(
        messageEvent({
          subtype: 'file_share',
          text: '<@U_BOT> この問題教えて',
          files: [
            { id: 'F1', mimetype: 'image/png', url_private: 'https://slack/F1', name: 'q.png', size: 1234 },
            { id: 'F2', mimetype: 'application/pdf', url_private: 'https://slack/F2' },
          ],
        }),
      ),
    )
    expect(res.status).toBe(200)
    expect(mocks.enqueueJob).toHaveBeenCalledOnce()
    const payload = mocks.enqueueJob.mock.calls[0][1]
    expect(payload.files).toEqual([
      { id: 'F1', name: 'q.png', mimetype: 'image/png', size: 1234, urlPrivate: 'https://slack/F1' },
    ])
  })
})
