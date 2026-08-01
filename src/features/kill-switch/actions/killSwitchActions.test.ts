/** @file
 * 検証: AI 応答トグル Server Action の認可（admin 限定）・入力検証・結果の受け渡し
 * @verifies DEC-15, FR-13, F-1
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'

vi.mock('@shared/lib/auth/requireAdmin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: vi.fn() }))
vi.mock('../lib/killSwitch', () => ({ setAIEnabled: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { toggleAiResponsesAction } from './killSwitchActions'
import { requireAdmin } from '@shared/lib/auth/requireAdmin'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { setAIEnabled } from '../lib/killSwitch'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

const adminOk = () =>
  vi.mocked(requireAdmin).mockResolvedValue({ userId: 'u1', email: 'admin@example.com' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createServerClient).mockReturnValue(createMockDb())
  vi.mocked(setAIEnabled).mockResolvedValue({ changed: true, notified: true })
})

describe('toggleAiResponsesAction', () => {
  it('未認証は切り替えずログイン要求を返す', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('unauthorized'))
    const r = await toggleAiResponsesAction(undefined, fd({ enabled: 'false', reason: '' }))
    expect(r).toEqual({ ok: false, error: 'ログインが必要です' })
    expect(setAIEnabled).not.toHaveBeenCalled()
  })

  it('staff（admin 以外）は切り替えられない（閲覧のみ）', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('forbidden'))
    const r = await toggleAiResponsesAction(undefined, fd({ enabled: 'false', reason: '' }))
    expect(r).toEqual({ ok: false, error: 'AI応答の停止・再開は管理者のみ実行できます' })
    expect(setAIEnabled).not.toHaveBeenCalled()
  })

  it('admin なら操作者のメールアドレス付きで停止できる', async () => {
    adminOk()
    const r = await toggleAiResponsesAction(undefined, fd({ enabled: 'false', reason: '障害対応' }))
    expect(r).toEqual({ ok: true, data: { enabled: false, notified: true } })
    expect(setAIEnabled).toHaveBeenCalledWith(expect.anything(), {
      enabled: false,
      reason: '障害対応',
      updatedBy: 'admin@example.com',
    })
  })

  it('#alerts に通知できなかった場合は notified=false を返す（UI で警告する）', async () => {
    adminOk()
    vi.mocked(setAIEnabled).mockResolvedValue({ changed: true, notified: false })
    const r = await toggleAiResponsesAction(undefined, fd({ enabled: 'false', reason: '' }))
    expect(r).toEqual({ ok: true, data: { enabled: false, notified: false } })
  })

  it('enabled が true/false 以外なら受け付けない', async () => {
    adminOk()
    const r = await toggleAiResponsesAction(undefined, fd({ enabled: 'maybe', reason: '' }))
    expect(r.ok).toBe(false)
    expect(setAIEnabled).not.toHaveBeenCalled()
  })

  it('理由が長すぎる場合はエラー', async () => {
    adminOk()
    const r = await toggleAiResponsesAction(
      undefined,
      fd({ enabled: 'false', reason: 'あ'.repeat(501) }),
    )
    expect(r).toEqual({ ok: false, error: '理由は500文字以内で入力してください' })
    expect(setAIEnabled).not.toHaveBeenCalled()
  })

  it('書き込み失敗は throw せずエラー文言を返す', async () => {
    adminOk()
    vi.mocked(setAIEnabled).mockRejectedValue(new Error('db down'))
    const r = await toggleAiResponsesAction(undefined, fd({ enabled: 'false', reason: '' }))
    expect(r.ok).toBe(false)
  })
})
