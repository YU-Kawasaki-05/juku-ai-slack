/** @file
 * 検証: Resend への送信リクエストの形（添付の base64・Idempotency-Key）とエラーの正規化、宛先のパース
 * @verifies FR-08
 */
import { describe, it, expect, vi } from 'vitest'
import { isValidFromAddress, parseRecipients, sendResendEmail } from './sendResendEmail'

const base = {
  apiKey: 're_secret_key',
  from: 'noreply@example.com',
  to: ['staff@example.com'],
  subject: '件名',
  text: '本文',
  attachments: [{ filename: '2026-09_生徒A.md', content: '# レポート\n日本語' }],
}

describe('sendResendEmail', () => {
  it('Resend API へ Bearer・Idempotency-Key 付きで POST し、添付は base64 にする', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"id":"x"}', { status: 200 }))
    const r = await sendResendEmail({ ...base, idempotencyKey: 'monthly-report-2026-09', fetchImpl })
    expect(r).toEqual({ ok: true })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer re_secret_key')
    expect(headers['Idempotency-Key']).toBe('monthly-report-2026-09')

    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ from: base.from, to: base.to, subject: '件名', text: '本文' })
    expect(body.attachments).toHaveLength(1)
    expect(body.attachments[0].filename).toBe('2026-09_生徒A.md')
    expect(Buffer.from(body.attachments[0].content, 'base64').toString('utf-8')).toBe('# レポート\n日本語')
  })

  it('非 2xx は ok:false（ステータスと本文の一部）。API キーはエラー文言に出ない', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"name":"validation_error","message":"bad from"}', { status: 422 }))
    const r = await sendResendEmail({ ...base, fetchImpl })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('HTTP 422')
      expect(r.error).toContain('bad from')
      expect(r.error).not.toContain('re_secret_key')
    }
  })

  it('通信失敗・タイムアウトも throw せず ok:false', async () => {
    const down = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    expect(await sendResendEmail({ ...base, fetchImpl: down })).toEqual({
      ok: false,
      error: 'Resend: 接続に失敗しました',
    })

    const timeout = vi.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    const r = await sendResendEmail({ ...base, fetchImpl: timeout })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('タイムアウト')
  })
})

describe('parseRecipients', () => {
  it('カンマ・セミコロン・空白・改行で区切れる。重複は 1 つにする', () => {
    expect(parseRecipients('a@example.com, b@example.com;c@example.com\nd@example.com a@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ])
  })
  it('形式が不正なものは捨てる。全部不正・空は空配列（= メール設定なし扱い）', () => {
    expect(parseRecipients('not-an-email, ok@example.com')).toEqual(['ok@example.com'])
    expect(parseRecipients('foo')).toEqual([])
    expect(parseRecipients('')).toEqual([])
    expect(parseRecipients(undefined)).toEqual([])
  })
})

describe('isValidFromAddress', () => {
  it('`addr` と `Name <addr>` の両方を受け付ける', () => {
    expect(isValidFromAddress('noreply@example.com')).toBe(true)
    expect(isValidFromAddress('marubo <noreply@example.com>')).toBe(true)
    expect(isValidFromAddress('塾 通知 <noreply@example.com>')).toBe(true)
    expect(isValidFromAddress('  noreply@example.com  ')).toBe(true)
  })
  it('空・不正・ヘッダ注入になる形は受け付けない', () => {
    expect(isValidFromAddress('')).toBe(false)
    expect(isValidFromAddress(undefined)).toBe(false)
    expect(isValidFromAddress('not an email')).toBe(false)
    expect(isValidFromAddress('Name <not-an-email>')).toBe(false)
    expect(isValidFromAddress('Name <a@b.com> <c@d.com>')).toBe(false)
    expect(isValidFromAddress('Name\r\nBcc: x@y.com <a@b.com>')).toBe(false)
  })
})
