/** @file
 * 検証: AI プロフィールフォームの初期値復元・fieldErrors 描画（H-8）・二重送信抑止（H-9）
 * @verifies FR-09, AC-09-01, DEC-18, H-8, H-9
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

import { StudentProfileForm } from './StudentProfileForm'
import type { Tables } from '@shared/types/db'

const PERSON_ID = '11111111-1111-4111-8111-111111111111'

const profile = (over: Partial<Tables<'student_profiles'>> = {}): Tables<'student_profiles'> => ({
  id: '22222222-2222-4222-8222-222222222222',
  person_id: PERSON_ID,
  summary: '文章題でつまずきやすい',
  learning_style: null,
  strengths: null,
  weaknesses: null,
  instruction_notes: null,
  exam_mode_until: null,
  exam_subjects: null,
  updated_at: '2026-08-01T00:00:00Z',
  ...over,
})

function setup(props: Partial<React.ComponentProps<typeof StudentProfileForm>> = {}) {
  const action = props.action ?? vi.fn(async () => ({ ok: true as const }))
  render(
    <StudentProfileForm
      action={action}
      personId={PERSON_ID}
      profile={null}
      examPeriod={{ active: false, endDate: '' }}
      today="2026-08-02"
      {...props}
    />,
  )
  return { action }
}

beforeEach(() => vi.clearAllMocks())

describe('StudentProfileForm（初期値）', () => {
  it('保存済みの値を復元する', () => {
    setup({ profile: profile({ learning_style: '図が入りやすい', exam_subjects: ['数学', '英語'] }) })
    expect(screen.getByLabelText('全体要約')).toHaveValue('文章題でつまずきやすい')
    expect(screen.getByLabelText('学習スタイル・説明トーン')).toHaveValue('図が入りやすい')
    expect(screen.getByLabelText('試験科目（任意）')).toHaveValue('数学, 英語')
  })

  it('FR-09 の上限に合わせた maxLength を付ける', () => {
    setup()
    expect(screen.getByLabelText('全体要約')).toHaveAttribute('maxlength', '2000')
    expect(screen.getByLabelText('学習スタイル・説明トーン')).toHaveAttribute('maxlength', '500')
    expect(screen.getByLabelText('得意分野')).toHaveAttribute('maxlength', '500')
    expect(screen.getByLabelText('苦手分野')).toHaveAttribute('maxlength', '500')
    expect(screen.getByLabelText('指導上の注意')).toHaveAttribute('maxlength', '1000')
  })

  it('試験期間が有効なら ON + 最終日を復元し、日付を編集できる', () => {
    setup({ examPeriod: { active: true, endDate: '2026-08-10' } })
    expect(screen.getByLabelText('試験期間中にする')).toBeChecked()
    const date = screen.getByLabelText(/最終日/)
    expect(date).toHaveValue('2026-08-10')
    expect(date).toBeEnabled()
    expect(date).toHaveAttribute('min', '2026-08-02')
  })

  it('試験期間 OFF のあいだは最終日を編集させない', () => {
    setup()
    expect(screen.getByLabelText('試験期間中にする')).not.toBeChecked()
    expect(screen.getByLabelText(/最終日/)).toBeDisabled()
  })

  it('チェックを入れると最終日が編集可能になる', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByLabelText('試験期間中にする'))
    expect(screen.getByLabelText(/最終日/)).toBeEnabled()
  })

  it('確認質問なしの direct 応答に変わることを説明する（BR-05-08 の平易な説明）', () => {
    setup()
    expect(screen.getByText(/確認の質問をはさまず/)).toBeInTheDocument()
  })
})

describe('StudentProfileForm（H-8: fieldErrors の描画）', () => {
  it('各フィールドのエラーを表示する', async () => {
    const action = vi.fn(async () => ({
      ok: false as const,
      error: '入力内容を確認してください',
      fieldErrors: {
        summary: '全体要約は2000文字以内で入力してください',
        learningStyle: '学習スタイルは500文字以内で入力してください',
        strengths: '得意分野は500文字以内で入力してください',
        weaknesses: '苦手分野は500文字以内で入力してください',
        instructionNotes: '指導上の注意は1000文字以内で入力してください',
        examEndDate: '試験期間の最終日を入力してください',
        examSubjects: '試験科目は20件以内で入力してください',
      },
    }))
    const user = userEvent.setup()
    setup({ action })

    await user.click(screen.getByRole('button', { name: 'プロフィールを保存' }))

    expect(await screen.findByText('全体要約は2000文字以内で入力してください')).toBeInTheDocument()
    for (const msg of [
      '学習スタイルは500文字以内で入力してください',
      '得意分野は500文字以内で入力してください',
      '苦手分野は500文字以内で入力してください',
      '指導上の注意は1000文字以内で入力してください',
      '試験期間の最終日を入力してください',
      '試験科目は20件以内で入力してください',
    ]) {
      expect(screen.getByText(msg)).toBeInTheDocument()
    }
    expect(screen.getByText('入力内容を確認してください')).toBeInTheDocument()
  })
})

describe('StudentProfileForm（H-9: 二重送信）', () => {
  it('保存成功直後は保存ボタンを無効にする', async () => {
    const user = userEvent.setup()
    const { action } = setup()
    await user.click(screen.getByRole('button', { name: 'プロフィールを保存' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'プロフィールを保存' })).toBeDisabled(),
    )
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('保存後に編集を再開したら再び保存できる（このページに留まるため）', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'プロフィールを保存' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'プロフィールを保存' })).toBeDisabled(),
    )

    await user.type(screen.getByLabelText('全体要約'), '追記')
    expect(screen.getByRole('button', { name: 'プロフィールを保存' })).toBeEnabled()
  })

  it('失敗時は再送信できる', async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: '保存に失敗しました' }))
    const user = userEvent.setup()
    setup({ action })
    await user.click(screen.getByRole('button', { name: 'プロフィールを保存' }))
    await screen.findByText('保存に失敗しました')
    expect(screen.getByRole('button', { name: 'プロフィールを保存' })).toBeEnabled()
  })
})
