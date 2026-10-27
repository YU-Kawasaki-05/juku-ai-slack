/** @file
 * 検証: env のパースが、月次レポート用の変数の不正値（空文字・`Name <addr>`・不正形式）で落ちないこと。
 *   落ちると Slack の回答まで 500 になる
 * @verifies FR-08
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const KEYS = ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'REPORT_EMAIL_TO', 'CRON_SECRET'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.resetModules()
})

async function loadEnv(vars: Partial<Record<(typeof KEYS)[number], string>>) {
  Object.assign(process.env, vars)
  vi.resetModules()
  return (await import('./env')).env
}

describe('env のパース（メール関連）', () => {
  it('RESEND_API_KEY が空文字でも落ちない', async () => {
    const env = await loadEnv({ RESEND_API_KEY: '' })
    expect(env.RESEND_API_KEY).toBe('')
  })

  it('RESEND_FROM_EMAIL が `Name <addr>` 形式でも、空文字でも、不正な値でも落ちない', async () => {
    expect((await loadEnv({ RESEND_FROM_EMAIL: 'Juku <noreply@example.com>' })).RESEND_FROM_EMAIL).toBe(
      'Juku <noreply@example.com>',
    )
    expect((await loadEnv({ RESEND_FROM_EMAIL: '' })).RESEND_FROM_EMAIL).toBe('')
    expect((await loadEnv({ RESEND_FROM_EMAIL: 'not an email' })).RESEND_FROM_EMAIL).toBe('not an email')
  })

  it('REPORT_EMAIL_TO・CRON_SECRET が空でも落ちない', async () => {
    const env = await loadEnv({ REPORT_EMAIL_TO: '', CRON_SECRET: '' })
    expect(env.REPORT_EMAIL_TO).toBe('')
    expect(env.CRON_SECRET).toBe('')
  })
})
