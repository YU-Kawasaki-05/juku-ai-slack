/** @file
 * 検証: cron ルートの認証（ヘッダなし・違う・シークレット未設定は 401、正しければ実行）と失敗時の 500
 * @verifies FR-08
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  logError: vi.fn(),
  env: { CRON_SECRET: 'cron-secret' as string | undefined },
}))

vi.mock('@shared/lib/env', () => ({ env: mocks.env }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: () => ({}) }))
vi.mock('@features/error-logs', () => ({ logError: mocks.logError }))
vi.mock('@features/monthly-reports', async () => {
  const actual = await vi.importActual<typeof import('@features/monthly-reports/lib/cronAuth')>(
    '@features/monthly-reports/lib/cronAuth',
  )
  return { verifyCronAuth: actual.verifyCronAuth, runScheduledMonthlyReports: mocks.run }
})

import { GET, maxDuration, dynamic } from './route'

const req = (auth?: string) =>
  new Request('http://localhost/api/cron/monthly-reports', {
    headers: auth ? { authorization: auth } : {},
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.env.CRON_SECRET = 'cron-secret'
  mocks.run.mockResolvedValue({ month: '2026-08', generated: 3, mail: 'sent' })
})

describe('GET /api/cron/monthly-reports', () => {
  it('Authorization が無ければ 401（何も実行しない）', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('シークレットが違えば 401', async () => {
    const res = await GET(req('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('CRON_SECRET が未設定・空なら、どんなヘッダでも 401（fail-open にしない）', async () => {
    mocks.env.CRON_SECRET = undefined
    expect((await GET(req('Bearer undefined'))).status).toBe(401)
    mocks.env.CRON_SECRET = ''
    expect((await GET(req('Bearer '))).status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('正しい Bearer なら実行し、結果を 200 で返す', async () => {
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: { month: '2026-08', generated: 3, mail: 'sent' } })
    expect(mocks.run).toHaveBeenCalledOnce()
  })

  it('実行が失敗したら 500 を返し、エラーを記録する（内部の詳細は返さない）', async () => {
    mocks.run.mockRejectedValue(new Error('db down: password=secret'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(500)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('password')
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'MONTHLY_REPORT_FAILED', severity: 'error' }),
    )
    err.mockRestore()
  })

  it('実行時間の上限を引き上げ、キャッシュしない', () => {
    expect(maxDuration).toBe(300)
    expect(dynamic).toBe('force-dynamic')
  })
})
