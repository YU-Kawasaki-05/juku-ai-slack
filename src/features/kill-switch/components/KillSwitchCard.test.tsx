/** @file
 * 検証: ダッシュボードの AI 応答カード（状態バッジ・理由表示・確認ダイアログ）
 * @verifies DEC-15, FR-18
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const toggleAction = vi.hoisted(() => vi.fn())
vi.mock('../actions/killSwitchActions', () => ({ toggleAiResponsesAction: toggleAction }))
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

import { KillSwitchCard } from './KillSwitchCard'

// Radix Dialog は jsdom に無い API を使う
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  toggleAction.mockResolvedValue({ ok: true, data: { enabled: false, notified: true } })
})

describe('KillSwitchCard', () => {
  it('稼働中は「稼働中」バッジと停止ボタンを出す', () => {
    render(
      <KillSwitchCard state={{ enabled: true, reason: null, updatedAt: null, updatedBy: null }} />,
    )
    expect(screen.getByText('稼働中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI応答を停止' })).toBeInTheDocument()
  })

  it('停止中は「停止中」バッジ・理由・操作者を出し、再開ボタンに切り替わる', () => {
    render(
      <KillSwitchCard
        state={{
          enabled: false,
          reason: 'LLM プロバイダ障害',
          updatedAt: '2026-08-02T03:04:00.000Z',
          updatedBy: 'admin@example.com',
        }}
      />,
    )
    expect(screen.getByText('停止中')).toBeInTheDocument()
    expect(screen.getByText(/LLM プロバイダ障害/)).toBeInTheDocument()
    expect(screen.getByText(/admin@example.com/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI応答を再開' })).toBeInTheDocument()
  })

  it('ボタンを押しただけでは切り替わらず、確認ダイアログを出す', async () => {
    const user = userEvent.setup()
    render(
      <KillSwitchCard state={{ enabled: true, reason: null, updatedAt: null, updatedBy: null }} />,
    )

    await user.click(screen.getByRole('button', { name: 'AI応答を停止' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('AI応答を停止しますか？')).toBeInTheDocument()
    expect(toggleAction).not.toHaveBeenCalled()
  })

  it('ダイアログで確定すると理由付きで Server Action を呼ぶ', async () => {
    const user = userEvent.setup()
    render(
      <KillSwitchCard state={{ enabled: true, reason: null, updatedAt: null, updatedBy: null }} />,
    )

    await user.click(screen.getByRole('button', { name: 'AI応答を停止' }))
    await user.type(await screen.findByLabelText(/理由/), 'コスト超過')
    await user.click(screen.getByRole('button', { name: '停止する' }))

    expect(toggleAction).toHaveBeenCalledOnce()
    const submitted = toggleAction.mock.calls[0][1] as FormData
    expect(submitted.get('enabled')).toBe('false')
    expect(submitted.get('reason')).toBe('コスト超過')
  })

  it('停止中から再開するときは enabled=true を送る', async () => {
    const user = userEvent.setup()
    render(
      <KillSwitchCard
        state={{ enabled: false, reason: '障害', updatedAt: null, updatedBy: null }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'AI応答を再開' }))
    await user.click(await screen.findByRole('button', { name: '再開する' }))

    expect((toggleAction.mock.calls[0][1] as FormData).get('enabled')).toBe('true')
  })
})
