/** @file
 * 検証: cron / 手動の対象月・最後の試行の判定、メール設定の解決（3 つ揃ったときだけ送れる）
 * @verifies FR-08
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  runMonthlyReports: vi.fn(),
  env: {
    RESEND_API_KEY: 're_test' as string | undefined,
    RESEND_FROM_EMAIL: 'noreply@example.com' as string | undefined,
    REPORT_EMAIL_TO: 'a@example.com, b@example.com' as string | undefined,
    LLM_MODEL_DEFAULT: 'm' as string | undefined,
  },
}))

vi.mock('@shared/lib/env', () => ({ env: mocks.env }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: () => ({}) }))
vi.mock('./runMonthlyReports', () => ({ runMonthlyReports: mocks.runMonthlyReports }))

import { resolveMailConfig, runManualMonthlyReports, runScheduledMonthlyReports } from './runtime'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.env.RESEND_API_KEY = 're_test'
  mocks.env.RESEND_FROM_EMAIL = 'noreply@example.com'
  mocks.env.REPORT_EMAIL_TO = 'a@example.com, b@example.com'
  mocks.runMonthlyReports.mockResolvedValue({})
})

describe('runScheduledMonthlyReports（cron: 毎月 1〜3 日 0:00 UTC）', () => {
  it('1 日目（日本時間 9:00）は前月が対象で、最後の試行ではない', async () => {
    await runScheduledMonthlyReports(new Date('2026-09-01T00:00:00Z'))
    expect(mocks.runMonthlyReports.mock.calls[0][1]).toEqual({ month: '2026-08', finalAttempt: false })
  })

  it('2 日目もまだ最後ではない', async () => {
    await runScheduledMonthlyReports(new Date('2026-09-02T00:00:00Z'))
    expect(mocks.runMonthlyReports.mock.calls[0][1]).toEqual({ month: '2026-08', finalAttempt: false })
  })

  it('3 日目は最後の試行', async () => {
    await runScheduledMonthlyReports(new Date('2026-09-03T00:00:00Z'))
    expect(mocks.runMonthlyReports.mock.calls[0][1]).toEqual({ month: '2026-08', finalAttempt: true })
  })

  it('年またぎ: 1 月 1 日の実行は前年 12 月が対象', async () => {
    await runScheduledMonthlyReports(new Date('2027-01-01T00:00:00Z'))
    expect(mocks.runMonthlyReports.mock.calls[0][1]).toMatchObject({ month: '2026-12' })
  })
})

describe('runManualMonthlyReports', () => {
  it('前月が対象で、最後の試行にはしない（残りは再度押してもらう）', async () => {
    await runManualMonthlyReports(new Date('2026-03-15T03:00:00Z'))
    expect(mocks.runMonthlyReports.mock.calls[0][1]).toEqual({ month: '2026-02' })
  })
})

describe('resolveMailConfig', () => {
  it('API キー・送信元・宛先が揃えば宛先を配列にして返す', () => {
    expect(resolveMailConfig()).toEqual({
      apiKey: 're_test',
      from: 'noreply@example.com',
      to: ['a@example.com', 'b@example.com'],
    })
  })

  it('送信元は `Name <addr>` 形式も受け付ける（Resend の from として正しい形）', () => {
    mocks.env.RESEND_FROM_EMAIL = 'marubo <noreply@example.com>'
    expect(resolveMailConfig()?.from).toBe('marubo <noreply@example.com>')
  })

  it('不正な送信元・宛先は例外にせず null（メール設定なし）にし、理由をログに出す', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.env.RESEND_FROM_EMAIL = 'not-an-email'
    expect(resolveMailConfig()).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('RESEND_FROM_EMAIL'))
    warn.mockClear()
    mocks.env.RESEND_FROM_EMAIL = 'noreply@example.com'
    mocks.env.REPORT_EMAIL_TO = 'nope'
    expect(resolveMailConfig()).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('REPORT_EMAIL_TO'))
    warn.mockRestore()
  })

  it.each([
    ['RESEND_API_KEY', undefined],
    ['RESEND_API_KEY', '  '],
    ['RESEND_FROM_EMAIL', undefined],
    ['RESEND_FROM_EMAIL', 'not-an-email'],
    ['RESEND_FROM_EMAIL', 'Name <broken>'],
    ['REPORT_EMAIL_TO', undefined],
    ['REPORT_EMAIL_TO', ''],
    ['REPORT_EMAIL_TO', 'not-an-email'],
  ] as const)('%s が %j なら送れない（null）', (key, value) => {
    mocks.env[key] = value
    expect(resolveMailConfig()).toBeNull()
  })
})
