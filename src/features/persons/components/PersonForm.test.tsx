/** @file
 * 検証: 生徒フォームの fieldErrors 全項目描画（H-8）、二重送信防止（H-9）、
 *   ヘルプ文が LLM に渡る範囲の実装と一致していること（学年は送る / 表示名は送らない）
 * @verifies FR-14, FR-09, H-8, H-9
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

import { PersonForm } from './PersonForm'

// StatusSelect（Radix Select）は jsdom に無い API を使う
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => vi.clearAllMocks())

describe('PersonForm（H-8: fieldErrors の描画）', () => {
  it('name 以外のフィールドのエラーも表示する', async () => {
    const action = vi.fn(async () => ({
      ok: false as const,
      error: '入力内容を確認してください',
      fieldErrors: {
        name: '名前は必須です',
        displayName: '表示名が長すぎます',
        grade: '学年が長すぎます',
        guardianEmail: 'メールアドレスの形式が正しくありません',
      },
    }))
    const user = userEvent.setup()
    render(<PersonForm action={action} />)

    await user.type(screen.getByLabelText(/名前/), '太郎')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('名前は必須です')).toBeInTheDocument()
    expect(screen.getByText('表示名が長すぎます')).toBeInTheDocument()
    expect(screen.getByText('学年が長すぎます')).toBeInTheDocument()
    expect(screen.getByText('メールアドレスの形式が正しくありません')).toBeInTheDocument()
  })

  it('スキーマの max に合わせた maxLength を入力に付ける', () => {
    render(<PersonForm action={vi.fn()} />)
    expect(screen.getByLabelText(/名前/)).toHaveAttribute('maxlength', '100')
    expect(screen.getByLabelText('表示名（任意）')).toHaveAttribute('maxlength', '100')
    expect(screen.getByLabelText('学年（任意）')).toHaveAttribute('maxlength', '50')
    expect(screen.getByLabelText('保護者メール（任意）')).toHaveAttribute('maxlength', '255')
  })
})

describe('PersonForm（H-9: 二重送信で二重登録させない）', () => {
  it('登録成功後は保存ボタンが無効のままになる', async () => {
    const action = vi.fn(async () => ({ ok: true as const }))
    const user = userEvent.setup()
    render(<PersonForm action={action} />)

    await user.type(screen.getByLabelText(/名前/), '太郎')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/persons'))
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('失敗時は再送信できる', async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: '保存に失敗しました' }))
    const user = userEvent.setup()
    render(<PersonForm action={action} />)

    await user.type(screen.getByLabelText(/名前/), '太郎')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await screen.findByText('保存に失敗しました')
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })
})

describe('PersonForm（ヘルプ文が実装と一致している）', () => {
  it('学年欄は AI に送られることと学年だけを書くことを伝える', () => {
    render(<PersonForm action={vi.fn()} />)

    const help = screen.getByText(
      /この欄の内容はそのまま AI に送られます。学年だけを書いてください/,
    )
    expect(help).toBeInTheDocument()
    expect(help).toHaveTextContent(/氏名や講師名は書かない/)
    expect(screen.getByLabelText('学年（任意）')).toHaveAttribute(
      'aria-describedby',
      'grade-help',
    )
  })

  it('学年欄のエラー時もヘルプ文が読み上げ対象に残る', async () => {
    const action = vi.fn(async () => ({
      ok: false as const,
      error: '入力内容を確認してください',
      fieldErrors: { grade: '学年が長すぎます' },
    }))
    const user = userEvent.setup()
    render(<PersonForm action={action} />)

    await user.type(screen.getByLabelText(/名前/), '太郎')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await screen.findByText('学年が長すぎます')
    expect(screen.getByLabelText('学年（任意）')).toHaveAttribute(
      'aria-describedby',
      'grade-error grade-help',
    )
  })

  // display_name は getStudentProfile / buildPrompt のどちらにも渡っていないので、
  // 「Bot が呼びかけに使う」と書くと実装に無い挙動を約束してしまう
  it('表示名欄は AI に送られないことを明示し、呼びかけに使うとは書かない', () => {
    render(<PersonForm action={vi.fn()} />)

    expect(screen.getByText(/AI には送られません/)).toBeInTheDocument()
    expect(screen.queryByText(/呼びかけ/)).not.toBeInTheDocument()
  })
})
