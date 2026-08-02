/** @file
 * 検証: 管理画面ページの認証ガード（middleware に加えた多層防御）と、
 *   未認証 / ロール未設定でリダイレクト先が分かれること
 * @verifies FR-13, D-2, AT-05
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@shared/lib/supabase/authServerClient', () => ({ createAuthServerClient: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    // 実際の next/navigation と同じく throw して以降の処理を止める
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

import { requireStaffPage } from './requireStaffPage'
import { createAuthServerClient } from '@shared/lib/supabase/authServerClient'
import { redirect } from 'next/navigation'

function mockGetUser(user: unknown) {
  vi.mocked(createAuthServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as unknown as Awaited<ReturnType<typeof createAuthServerClient>>)
}

beforeEach(() => vi.clearAllMocks())

describe('requireStaffPage', () => {
  it('staff ロールがあれば StaffContext を返す（リダイレクトしない）', async () => {
    mockGetUser({ id: 'user-1', email: 'staff@example.com', app_metadata: { role: 'staff' } })
    await expect(requireStaffPage()).resolves.toEqual({
      userId: 'user-1',
      email: 'staff@example.com',
    })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('未認証は /login へリダイレクトする（throw して以降を実行しない）', async () => {
    mockGetUser(null)
    await expect(requireStaffPage()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  /**
   * ログイン済みなのに /login へ戻すと、ログインし直しても同じ画面に戻る無限ループに見えて
   * 原因（ロール未設定）に辿り着けない。専用ページへ案内する。
   */
  it('ログイン済みでロール未設定は /admin/no-access へ案内する', async () => {
    mockGetUser({ id: 'user-2', email: 'noroles@example.com', app_metadata: {} })
    await expect(requireStaffPage()).rejects.toThrow('NEXT_REDIRECT:/admin/no-access')
    expect(redirect).toHaveBeenCalledWith('/admin/no-access')
  })

  it('Supabase 側の例外も未認証として /login へ倒す', async () => {
    vi.mocked(createAuthServerClient).mockRejectedValue(new Error('network down'))
    await expect(requireStaffPage()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})
