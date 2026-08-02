/** @file
 * 検証: 生徒 Server Action の認証ガード・入力検証・保存
 * @verifies AC-14-02
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'

vi.mock('@shared/lib/auth/requireStaff', () => ({ requireStaff: vi.fn() }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createPersonAction, updatePersonAction } from './personActions'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { createServerClient } from '@shared/lib/supabase/serverClient'

const PERSON_ID = '11111111-1111-4111-8111-111111111111'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

const staffOk = () => vi.mocked(requireStaff).mockResolvedValue({ userId: 'u1', email: 'a@b.com' })

beforeEach(() => vi.clearAllMocks())

describe('createPersonAction', () => {
  it('未認証はログイン要求（throw しない）', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('unauthorized'))
    const r = await createPersonAction(undefined, fd({ name: '太郎' }))
    expect(r).toEqual({ ok: false, error: 'ログインが必要です' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // ロール未設定は「ログインし直せ」では解決しないので文言を分ける（AT-05）
  it('ロール未設定は権限がない旨を返す（DB に触れない）', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('forbidden'))
    const r = await createPersonAction(undefined, fd({ name: '太郎' }))
    expect(r).toEqual({ ok: false, error: 'このアカウントには管理画面の利用権限がありません' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('名前が空なら fieldErrors', async () => {
    staffOk()
    const r = await createPersonAction(undefined, fd({ name: '  ' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fieldErrors?.name).toBeTruthy()
  })

  it('正常時は insert して ok', async () => {
    staffOk()
    const db = createMockDb({ thenable: { error: null } })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await createPersonAction(undefined, fd({ name: '太郎', status: 'active' }))
    expect(r).toEqual({ ok: true })
    expect(db.__calls.insert[0]).toMatchObject({ name: '太郎', status: 'active' })
  })

  it('DB エラーは保存失敗メッセージ', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(createMockDb({ thenable: { error: { message: 'boom' } } }))
    const r = await createPersonAction(undefined, fd({ name: '太郎' }))
    expect(r).toEqual({ ok: false, error: '保存に失敗しました' })
  })
})

describe('updatePersonAction', () => {
  it('正常時は update して ok', async () => {
    staffOk()
    const db = createMockDb({ thenable: { data: [{ id: PERSON_ID }], error: null } })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await updatePersonAction(undefined, fd({ id: PERSON_ID, name: '花子', status: 'inactive' }))
    expect(r).toEqual({ ok: true })
    expect(db.__calls.update[0]).toMatchObject({ name: '花子', status: 'inactive' })
  })

  it('H-10: 0 行マッチなら「保存しました」ではなく対象なしエラーを返す', async () => {
    staffOk()
    const db = createMockDb({ thenable: { data: [], error: null } })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await updatePersonAction(undefined, fd({ id: PERSON_ID, name: '花子' }))
    expect(r).toEqual({ ok: false, error: '対象が見つかりません' })
  })

  it('DB エラーは保存失敗メッセージ', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(
      createMockDb({ thenable: { data: null, error: { message: 'boom' } } }),
    )
    const r = await updatePersonAction(undefined, fd({ id: PERSON_ID, name: '花子' }))
    expect(r).toEqual({ ok: false, error: '保存に失敗しました' })
  })
})
