/** @file
 * 検証: 管理者ガード（app_metadata.role による判定。user_metadata では昇格できない）
 * @verifies BR-16-02（EP-14: Embedding 再生成は admin のみ）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireAdmin } from './requireAdmin'
import { createAuthServerClient } from '@shared/lib/supabase/authServerClient'

vi.mock('@shared/lib/supabase/authServerClient', () => ({
  createAuthServerClient: vi.fn(),
}))

function mockGetUser(user: unknown) {
  vi.mocked(createAuthServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as unknown as Awaited<ReturnType<typeof createAuthServerClient>>)
}

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('app_metadata.role = admin なら StaffContext を返す', async () => {
    mockGetUser({
      id: 'user-1',
      email: 'admin@example.com',
      app_metadata: { role: 'admin' },
      user_metadata: {},
    })
    await expect(requireAdmin()).resolves.toEqual({
      userId: 'user-1',
      email: 'admin@example.com',
    })
  })

  it('未認証は unauthorized', async () => {
    mockGetUser(null)
    await expect(requireAdmin()).rejects.toThrow('unauthorized')
  })

  it('app_metadata.role が admin 以外（staff / 未設定）は forbidden', async () => {
    mockGetUser({ id: 'u', email: 's@example.com', app_metadata: { role: 'staff' }, user_metadata: {} })
    await expect(requireAdmin()).rejects.toThrow('forbidden')

    mockGetUser({ id: 'u', email: 's@example.com', app_metadata: {}, user_metadata: {} })
    await expect(requireAdmin()).rejects.toThrow('forbidden')
  })

  it('user_metadata.role = admin だけでは昇格できない（権限昇格の回帰テスト）', async () => {
    // 攻撃シナリオ: 非管理者が supabase.auth.updateUser({ data: { role: 'admin' } }) で
    // user_metadata を自己書き換えしても、app_metadata が admin でなければ拒否される
    mockGetUser({
      id: 'attacker',
      email: 'staff@example.com',
      app_metadata: { role: 'staff' },
      user_metadata: { role: 'admin' },
    })
    await expect(requireAdmin()).rejects.toThrow('forbidden')
  })
})
