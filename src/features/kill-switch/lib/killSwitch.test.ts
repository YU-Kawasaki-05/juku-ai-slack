/** @file
 * 検証: kill_switch の読み取り（fail-open）・切替・#alerts 通知（DEC-15 / F-1）
 * @verifies DEC-15, F-1
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const envMock = vi.hoisted(() => ({
  env: { SLACK_ALERTS_CHANNEL_ID: 'C_ALERTS' as string | undefined },
}))
vi.mock('@shared/lib/env', () => ({ env: envMock.env }))

const slackMocks = vi.hoisted(() => ({ postMessage: vi.fn() }))
vi.mock('@shared/lib/slack/client', () => ({ postMessage: slackMocks.postMessage }))

import {
  AI_KILL_SWITCH_NAME,
  buildKillSwitchAlertText,
  getAIKillSwitch,
  isAIEnabled,
  setAIEnabled,
} from './killSwitch'
import { createMockDb } from '@/test/mocks/supabaseMock'

const enabledRow = {
  enabled: true,
  reason: null,
  updated_at: '2026-08-01T00:00:00.000Z',
  updated_by: 'admin@example.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  envMock.env.SLACK_ALERTS_CHANNEL_ID = 'C_ALERTS'
  slackMocks.postMessage.mockResolvedValue({ ts: '1' })
})

describe('getAIKillSwitch / isAIEnabled', () => {
  it('行の状態をそのまま返す', async () => {
    const db = createMockDb({ maybeSingle: { data: { ...enabledRow, enabled: false, reason: '障害対応' }, error: null } })
    const state = await getAIKillSwitch(db)
    expect(state).toEqual({
      enabled: false,
      reason: '障害対応',
      updatedAt: '2026-08-01T00:00:00.000Z',
      updatedBy: 'admin@example.com',
    })
    expect(db.__calls.eq).toContainEqual(['name', AI_KILL_SWITCH_NAME])
  })

  it('行が無ければ enabled=true にフォールバックする（fail-open）', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: null } })
    expect(await isAIEnabled(db)).toBe(true)
  })

  it('読み取りエラーでも enabled=true（kill_switch の障害で全停止させない）', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: { message: 'boom' } } })
    expect(await isAIEnabled(db)).toBe(true)
  })

  it('クエリ自体が throw しても enabled=true', async () => {
    const db = {
      from: () => {
        throw new Error('connection refused')
      },
    } as never
    expect(await isAIEnabled(db)).toBe(true)
  })
})

describe('setAIEnabled', () => {
  it('name をキーに upsert して操作者・理由・時刻を残す', async () => {
    const db = createMockDb({ maybeSingle: { data: enabledRow, error: null } })
    await setAIEnabled(db, { enabled: false, reason: ' 障害対応 ', updatedBy: 'admin@example.com' })

    const upserted = db.__calls.upsert[0] as Record<string, unknown>
    expect(upserted).toMatchObject({
      name: AI_KILL_SWITCH_NAME,
      enabled: false,
      reason: '障害対応', // 前後の空白は落とす
      updated_by: 'admin@example.com',
    })
    expect(typeof upserted.updated_at).toBe('string')
    expect(db.__calls.upsertOptions[0]).toEqual({ onConflict: 'name' })
  })

  it('空文字の理由・操作者は null で保存する', async () => {
    const db = createMockDb({ maybeSingle: { data: enabledRow, error: null } })
    await setAIEnabled(db, { enabled: false, reason: '   ', updatedBy: '' })
    expect(db.__calls.upsert[0]).toMatchObject({ reason: null, updated_by: null })
  })

  it('状態が変化したら #alerts に通知する（DEC-15）', async () => {
    const db = createMockDb({ maybeSingle: { data: enabledRow, error: null } })
    const result = await setAIEnabled(db, {
      enabled: false,
      reason: 'コスト超過',
      updatedBy: 'admin@example.com',
    })

    expect(result).toEqual({ changed: true, notified: true })
    expect(slackMocks.postMessage).toHaveBeenCalledOnce()
    const text = slackMocks.postMessage.mock.calls[0][0].text as string
    expect(slackMocks.postMessage.mock.calls[0][0].channel).toBe('C_ALERTS')
    expect(text).toContain('停止')
    expect(text).toContain('admin@example.com')
    expect(text).toContain('コスト超過')
  })

  it('同じ状態への更新では通知しない（変化時のみ, DEC-15）', async () => {
    const db = createMockDb({ maybeSingle: { data: enabledRow, error: null } })
    const result = await setAIEnabled(db, { enabled: true, updatedBy: 'admin@example.com' })
    expect(result).toEqual({ changed: false, notified: false })
    expect(slackMocks.postMessage).not.toHaveBeenCalled()
  })

  it('再開時は再開の文言で通知する', async () => {
    const db = createMockDb({ maybeSingle: { data: { ...enabledRow, enabled: false }, error: null } })
    await setAIEnabled(db, { enabled: true, reason: '復旧確認', updatedBy: 'admin@example.com' })
    expect(slackMocks.postMessage.mock.calls[0][0].text).toContain('再開')
  })

  it('SLACK_ALERTS_CHANNEL_ID 未設定なら通知をスキップするが切替は成功する', async () => {
    envMock.env.SLACK_ALERTS_CHANNEL_ID = undefined
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = createMockDb({ maybeSingle: { data: enabledRow, error: null } })

    const result = await setAIEnabled(db, { enabled: false, updatedBy: 'admin@example.com' })

    expect(result).toEqual({ changed: true, notified: false })
    expect(slackMocks.postMessage).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('通知の失敗は切替を巻き戻さない（notified=false で返す）', async () => {
    slackMocks.postMessage.mockRejectedValue(new Error('slack down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = createMockDb({ maybeSingle: { data: enabledRow, error: null } })

    const result = await setAIEnabled(db, { enabled: false, updatedBy: 'admin@example.com' })

    expect(result).toEqual({ changed: true, notified: false })
    expect(db.__calls.upsert).toHaveLength(1)
    errorSpy.mockRestore()
  })

  it('書き込み失敗は throw する（管理画面にエラーを出すため）', async () => {
    const db = createMockDb({
      maybeSingle: { data: enabledRow, error: null },
      thenable: { error: { message: 'permission denied' } },
    })
    await expect(setAIEnabled(db, { enabled: false })).rejects.toThrow(/permission denied/)
    expect(slackMocks.postMessage).not.toHaveBeenCalled()
  })
})

describe('buildKillSwitchAlertText', () => {
  it('操作者・理由・時刻（JST）を載せる', () => {
    const text = buildKillSwitchAlertText({
      enabled: false,
      reason: 'コスト超過',
      updatedBy: 'admin@example.com',
      updatedAt: '2026-08-02T03:04:00.000Z',
    })
    expect(text).toContain('操作者: admin@example.com')
    expect(text).toContain('理由: コスト超過')
    // UTC 03:04 → JST 12:04
    expect(text).toContain('12:04')
  })

  it('未入力の理由・操作者もプレースホルダで埋める', () => {
    const text = buildKillSwitchAlertText({
      enabled: true,
      reason: null,
      updatedBy: null,
      updatedAt: '2026-08-02T03:04:00.000Z',
    })
    expect(text).toContain('操作者: 不明')
    expect(text).toContain('理由: （未記入）')
  })

  it('理由に含まれる Slack 制御記法をエスケープする（C-3）', () => {
    const text = buildKillSwitchAlertText({
      enabled: false,
      reason: '<!channel> 緊急 & 重要',
      updatedBy: null,
      updatedAt: '2026-08-02T03:04:00.000Z',
    })
    expect(text).toContain('&lt;!channel&gt; 緊急 &amp; 重要')
    expect(text).not.toContain('<!channel>')
  })
})
