/** @file
 * 検証: 管理画面ページの認証ガード（middleware に加えた多層防御）
 * @verifies FR-13, D-2
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
  it('認証済みなら StaffContext を返す（リダイレクトしない）', async () => {
    mockGetUser({ id: 'user-1', email: 'staff@example.com' })
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

  it('Supabase 側の例外も未認証として /login へ倒す', async () => {
    vi.mocked(createAuthServerClient).mockRejectedValue(new Error('network down'))
    await expect(requireStaffPage()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})
