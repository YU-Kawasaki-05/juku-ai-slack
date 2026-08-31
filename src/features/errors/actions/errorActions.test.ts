/** @file
 * 検証: エラーログ Server Action の認証ガード・対応済みトグル・メモ保存
 * @verifies AC-17-02, AC-17-03, BR-17-03
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'

vi.mock('@shared/lib/auth/requireStaff', () => ({ requireStaff: vi.fn() }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { resolveErrorAction, updateErrorNotesAction } from './errorActions'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { createServerClient } from '@shared/lib/supabase/serverClient'

const ERROR_ID = '33333333-3333-4333-8333-333333333333'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

const staffOk = () => vi.mocked(requireStaff).mockResolvedValue({ userId: 'u1', email: 'a@b.com', role: 'staff' })

beforeEach(() => vi.clearAllMocks())

describe('resolveErrorAction', () => {
  it('未認証はログイン要求（throw しない）', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('unauthorized'))
    const r = await resolveErrorAction(undefined, fd({ id: ERROR_ID, resolved: 'true' }))
    expect(r).toEqual({ ok: false, error: 'ログインが必要です' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // ロール未設定は「ログインし直せ」では解決しないので文言を分ける（AT-05）
  it('ロール未設定は権限がない旨を返す（DB に触れない）', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('forbidden'))
    const r = await resolveErrorAction(undefined, fd({ id: ERROR_ID, resolved: 'true' }))
    expect(r).toEqual({ ok: false, error: 'このアカウントには管理画面の利用権限がありません' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('resolved を更新して ok を返す', async () => {
    staffOk()
    const db = createMockDb({ thenable: { data: [{ id: ERROR_ID }], error: null } })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await resolveErrorAction(undefined, fd({ id: ERROR_ID, resolved: 'true' }))
    expect(r).toEqual({ ok: true })
    expect(db.__calls.update[0]).toEqual({ resolved: true })
  })

  it('不正な resolved 値は入力エラー', async () => {
    staffOk()
    const r = await resolveErrorAction(undefined, fd({ id: ERROR_ID, resolved: 'yes' }))
    expect(r).toEqual({ ok: false, error: '入力内容を確認してください' })
  })

  it('H-10: 0 行マッチなら「更新しました」ではなく対象なしエラーを返す', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(createMockDb({ thenable: { data: [], error: null } }))
    const r = await resolveErrorAction(undefined, fd({ id: ERROR_ID, resolved: 'true' }))
    expect(r).toEqual({ ok: false, error: '対象が見つかりません' })
  })
})

describe('updateErrorNotesAction', () => {
  it('メモを保存する', async () => {
    staffOk()
    const db = createMockDb({ thenable: { data: [{ id: ERROR_ID }], error: null } })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await updateErrorNotesAction(undefined, fd({ id: ERROR_ID, notes: '再発なし' }))
    expect(r).toEqual({ ok: true })
    expect(db.__calls.update[0]).toEqual({ notes: '再発なし' })
  })

  it('空メモは null に正規化して保存する', async () => {
    staffOk()
    const db = createMockDb({ thenable: { data: [{ id: ERROR_ID }], error: null } })
    vi.mocked(createServerClient).mockReturnValue(db)
    await updateErrorNotesAction(undefined, fd({ id: ERROR_ID, notes: '   ' }))
    expect(db.__calls.update[0]).toEqual({ notes: null })
  })

  it('H-10: 0 行マッチなら対象なしエラーを返す', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(createMockDb({ thenable: { data: [], error: null } }))
    const r = await updateErrorNotesAction(undefined, fd({ id: ERROR_ID, notes: 'x' }))
    expect(r).toEqual({ ok: false, error: '対象が見つかりません' })
  })
})
