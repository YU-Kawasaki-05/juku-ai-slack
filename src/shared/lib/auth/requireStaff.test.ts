/** @file
 * 検証: スタッフガード（app_metadata.role による判定。ロール未設定では管理画面を使えない）
 * @verifies AT-05, EP-02〜EP-18（03_権限設計）, FR-13
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireStaff } from './requireStaff'
import { createAuthServerClient } from '@shared/lib/supabase/authServerClient'

vi.mock('@shared/lib/supabase/authServerClient', () => ({
  createAuthServerClient: vi.fn(),
}))

function mockGetUser(user: unknown) {
  vi.mocked(createAuthServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as unknown as Awaited<ReturnType<typeof createAuthServerClient>>)
}

beforeEach(() => vi.clearAllMocks())

describe('requireStaff', () => {
  it('app_metadata.role = staff なら StaffContext を返す', async () => {
    mockGetUser({ id: 'u1', email: 'staff@example.com', app_metadata: { role: 'staff' } })
    await expect(requireStaff()).resolves.toEqual({ userId: 'u1', email: 'staff@example.com' })
  })

  it('admin は staff の上位なので通す', async () => {
    mockGetUser({ id: 'u2', email: 'admin@example.com', app_metadata: { role: 'admin' } })
    await expect(requireStaff()).resolves.toEqual({ userId: 'u2', email: 'admin@example.com' })
  })

  it('未認証は unauthorized', async () => {
    mockGetUser(null)
    await expect(requireStaff()).rejects.toThrow('unauthorized')
  })

  /**
   * AT-05 の回帰テスト: 管理画面は Service Role で DB を読むため RLS を迂回する。
   * 認証だけを見ていた頃は「サインアップできただけ」のアカウントで全生徒 PII が見えていた。
   */
  it('ロール未設定（サインアップできただけ）は forbidden', async () => {
    mockGetUser({ id: 'u3', email: 'nobody@example.com', app_metadata: {} })
    await expect(requireStaff()).rejects.toThrow('forbidden')

    mockGetUser({ id: 'u3', email: 'nobody@example.com' })
    await expect(requireStaff()).rejects.toThrow('forbidden')
  })

  it('未知のロール（student など）は forbidden', async () => {
    mockGetUser({ id: 'u4', email: 'x@example.com', app_metadata: { role: 'student' } })
    await expect(requireStaff()).rejects.toThrow('forbidden')
  })

  it('user_metadata.role = staff だけでは通らない（権限昇格の回帰テスト）', async () => {
    // 本人が auth.updateUser({ data: { role } }) で書き換えられるのは user_metadata のみ
    mockGetUser({
      id: 'attacker',
      email: 'attacker@example.com',
      app_metadata: {},
      user_metadata: { role: 'staff' },
    })
    await expect(requireStaff()).rejects.toThrow('forbidden')
  })
})
