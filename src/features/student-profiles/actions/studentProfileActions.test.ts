/** @file
 * 検証: プロフィール UPSERT Server Action の認証ガード・入力検証・書き込み内容
 * @verifies FR-09, AC-09-01, BR-09-01, DEC-18
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'

vi.mock('@shared/lib/auth/requireStaff', () => ({ requireStaff: vi.fn() }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { upsertStudentProfileAction } from './studentProfileActions'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { revalidatePath } from 'next/cache'

const PERSON_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '22222222-2222-4222-8222-222222222222'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

const staffOk = () => vi.mocked(requireStaff).mockResolvedValue({ userId: 'u1', email: 'a@b.com' , role: 'staff' })
const okDb = () => createMockDb({ thenable: { data: [{ id: PROFILE_ID }], error: null } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-02T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('upsertStudentProfileAction', () => {
  it('未認証はログイン要求（throw しない・DB に触れない）', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('unauthorized'))
    const r = await upsertStudentProfileAction(undefined, fd({ personId: PERSON_ID }))
    expect(r).toEqual({ ok: false, error: 'ログインが必要です' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // ロール未設定は「ログインし直せ」では解決しないので文言を分ける（AT-05）
  it('ロール未設定は権限がない旨を返す（DB に触れない）', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('forbidden'))
    const r = await upsertStudentProfileAction(undefined, fd({ personId: PERSON_ID }))
    expect(r).toEqual({ ok: false, error: 'このアカウントには管理画面の利用権限がありません' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('AC-09-01: person_id をキーに UPSERT する（1人1レコード, BR-09-01）', async () => {
    staffOk()
    const db = okDb()
    vi.mocked(createServerClient).mockReturnValue(db)

    const r = await upsertStudentProfileAction(
      undefined,
      fd({
        personId: PERSON_ID,
        summary: '文章題でつまずきやすい',
        learningStyle: '図が入りやすい',
        strengths: '基礎計算',
        weaknesses: '文章題',
        instructionNotes: 'まず考え方から',
      }),
    )

    expect(r).toEqual({ ok: true })
    expect(db.__calls.from).toContain('student_profiles')
    expect(db.__calls.upsert[0]).toEqual({
      person_id: PERSON_ID,
      summary: '文章題でつまずきやすい',
      learning_style: '図が入りやすい',
      strengths: '基礎計算',
      weaknesses: '文章題',
      instruction_notes: 'まず考え方から',
      exam_mode_until: null,
      exam_subjects: null,
    })
    expect(db.__calls.upsertOptions[0]).toEqual({ onConflict: 'person_id' })
  })

  it('保存後に一覧と詳細を revalidate する', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(okDb())
    await upsertStudentProfileAction(undefined, fd({ personId: PERSON_ID, summary: 'x' }))
    expect(revalidatePath).toHaveBeenCalledWith('/admin/persons')
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/persons/${PERSON_ID}`)
  })

  it('試験期間 ON は exam_mode_until と exam_subjects を書き込む（DEC-18）', async () => {
    staffOk()
    const db = okDb()
    vi.mocked(createServerClient).mockReturnValue(db)

    await upsertStudentProfileAction(
      undefined,
      fd({
        personId: PERSON_ID,
        examMode: 'on',
        examEndDate: '2026-08-10',
        examSubjects: '数学, 英語',
      }),
    )

    expect(db.__calls.upsert[0]).toMatchObject({
      exam_mode_until: '2026-08-10T15:00:00.000Z',
      exam_subjects: ['数学', '英語'],
    })
  })

  it('チェックを外したら exam_mode_until を NULL に戻す（解除できる）', async () => {
    staffOk()
    const db = okDb()
    vi.mocked(createServerClient).mockReturnValue(db)
    await upsertStudentProfileAction(
      undefined,
      fd({ personId: PERSON_ID, examEndDate: '2026-08-10' }),
    )
    expect(db.__calls.upsert[0]).toMatchObject({ exam_mode_until: null })
  })

  it('入力エラーは fieldErrors を返す（H-8）', async () => {
    staffOk()
    const r = await upsertStudentProfileAction(
      undefined,
      fd({ personId: PERSON_ID, examMode: 'on', examEndDate: '' }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fieldErrors?.examEndDate).toBeTruthy()
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('H-10: 0 行なら成功扱いにしない', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(
      createMockDb({ thenable: { data: [], error: null } }),
    )
    const r = await upsertStudentProfileAction(undefined, fd({ personId: PERSON_ID, summary: 'x' }))
    expect(r).toEqual({ ok: false, error: '保存に失敗しました' })
  })

  it('存在しない生徒 ID（外部キー違反）は専用メッセージ', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(
      createMockDb({ thenable: { data: null, error: { code: '23503', message: 'fk' } } }),
    )
    const r = await upsertStudentProfileAction(undefined, fd({ personId: PERSON_ID, summary: 'x' }))
    expect(r).toEqual({ ok: false, error: '対象の生徒が見つかりません' })
  })

  it('DB エラーは保存失敗メッセージ', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(
      createMockDb({ thenable: { data: null, error: { message: 'boom' } } }),
    )
    const r = await upsertStudentProfileAction(undefined, fd({ personId: PERSON_ID, summary: 'x' }))
    expect(r).toEqual({ ok: false, error: '保存に失敗しました' })
  })
})
