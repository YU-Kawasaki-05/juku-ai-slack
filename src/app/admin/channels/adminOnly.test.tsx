/** @file
 * 検証: チャンネル紐付け画面の admin 限定ガード（EP-07）。
 *   staff は画面に入れず案内が出ること、未認証は再ログインへ倒れること
 * @verifies FR-13, FR-15, EP-07
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@shared/lib/auth/requireAdmin', () => ({ requireAdmin: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    // 実際の next/navigation と同じく throw して以降の処理を止める
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

import { ChannelAdminOnlyNotice, hasChannelAdminAccess } from './adminOnly'
import { requireAdmin } from '@shared/lib/auth/requireAdmin'
import { redirect } from 'next/navigation'

beforeEach(() => vi.clearAllMocks())

describe('hasChannelAdminAccess', () => {
  it('admin は true（画面をそのまま表示する）', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ userId: 'u1', email: 'admin@example.com', role: 'admin' })
    await expect(hasChannelAdminAccess()).resolves.toBe(true)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('staff（forbidden）は false。リダイレクトせず案内を出す', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('forbidden'))
    await expect(hasChannelAdminAccess()).resolves.toBe(false)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('未認証（unauthorized）は /login へ倒す', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('unauthorized'))
    await expect(hasChannelAdminAccess()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})

describe('ChannelAdminOnlyNotice', () => {
  it('管理者限定である旨と戻る導線だけを出す（フォームや一覧は出さない）', () => {
    render(<ChannelAdminOnlyNotice />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'チャンネル紐付けの管理は管理者（admin）のみが利用できます',
    )
    expect(screen.getByRole('link', { name: 'ダッシュボードへ戻る' })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '紐付ける' })).not.toBeInTheDocument()
  })
})
