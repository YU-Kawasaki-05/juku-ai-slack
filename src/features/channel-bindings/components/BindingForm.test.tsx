/** @file
 * 検証: 紐付けフォームの既定レポート選択（H-11）・fieldErrors 描画（H-8）・二重送信防止（H-9）、
 *   および確定前の確認ダイアログ（生徒名を出す / キャンセルで送信しない）
 * @verifies FR-15, AC-15-01, H-8, H-9, H-11
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.fn()
const createBindingAction = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))
vi.mock('../actions/bindingActions', () => ({
  createBindingAction: (...args: unknown[]) => createBindingAction(...args),
}))

import { BindingForm } from './BindingForm'

const persons = [
  { id: '11111111-1111-4111-8111-111111111111', name: '山田太郎' },
  { id: '22222222-2222-4222-8222-222222222222', name: '佐藤花子' },
]
const reports = [
  { id: 'r1', personId: persons[0].id, label: '2026年6月 6月レポート' },
  { id: 'r2', personId: persons[1].id, label: '2026年6月 花子6月' },
]

// Radix Select は jsdom に無い Pointer Capture / ResizeObserver を使う
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

beforeEach(() => {
  vi.clearAllMocks()
  createBindingAction.mockResolvedValue({ ok: true })
})

/** required 属性があると未入力のまま submit してもフォームが送信されないため先に埋める */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/SlackチャンネルID/), 'C01ABCDEFGH')
  await user.type(screen.getByLabelText(/ワークスペースID/), 'T01ABCDEFGH')
  await user.click(screen.getByLabelText(/生徒/))
  await user.click(await screen.findByRole('option', { name: '山田太郎' }))
}

/** 「紐付ける」は確認ダイアログを開くだけ。実際の送信はダイアログの確定ボタン */
async function submitViaConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '紐付ける' }))
  await user.click(await screen.findByRole('button', { name: '紐付けを確定する' }))
}

describe('BindingForm（H-11: 既定レポート）', () => {
  it('生徒未選択のうちは既定レポートを選べない', () => {
    render(<BindingForm persons={persons} reports={reports} />)
    expect(screen.getByLabelText('既定レポート（任意）')).toBeDisabled()
    expect(screen.getByText('先に生徒を選択してください')).toBeInTheDocument()
  })

  it('生徒を選ぶと、その生徒のレポートだけが候補になる', async () => {
    const user = userEvent.setup()
    render(<BindingForm persons={persons} reports={reports} />)

    await user.click(screen.getByLabelText(/生徒/))
    await user.click(await screen.findByRole('option', { name: '山田太郎' }))

    const reportSelect = screen.getByLabelText('既定レポート（任意）')
    await waitFor(() => expect(reportSelect).toBeEnabled())
    await user.click(reportSelect)

    expect(await screen.findByRole('option', { name: '2026年6月 6月レポート' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '2026年6月 花子6月' })).not.toBeInTheDocument()
  })

  it('レポートが無い生徒ではその旨を伝える', async () => {
    const user = userEvent.setup()
    render(<BindingForm persons={persons} reports={[reports[0]]} />)

    await user.click(screen.getByLabelText(/生徒/))
    await user.click(await screen.findByRole('option', { name: '佐藤花子' }))

    expect(
      await screen.findByText('この生徒には承認済みのレポートがまだありません'),
    ).toBeInTheDocument()
  })

  it('選択した既定レポートが FormData に載る', async () => {
    const user = userEvent.setup()
    render(<BindingForm persons={persons} reports={reports} />)

    await user.type(screen.getByLabelText(/SlackチャンネルID/), 'C01ABCDEFGH')
    await user.type(screen.getByLabelText(/ワークスペースID/), 'T01ABCDEFGH')
    await user.click(screen.getByLabelText(/生徒/))
    await user.click(await screen.findByRole('option', { name: '山田太郎' }))
    await user.click(screen.getByLabelText('既定レポート（任意）'))
    await user.click(await screen.findByRole('option', { name: '2026年6月 6月レポート' }))
    await submitViaConfirm(user)

    await waitFor(() => expect(createBindingAction).toHaveBeenCalled())
    const fd = createBindingAction.mock.calls[0][1] as FormData
    expect(fd.get('personId')).toBe(persons[0].id)
    expect(fd.get('defaultReportId')).toBe('r1')
  })
})

describe('BindingForm（H-8 / H-9）', () => {
  it('DB カラム長に合わせた maxLength を入力に付ける', () => {
    render(<BindingForm persons={persons} />)
    expect(screen.getByLabelText(/SlackチャンネルID/)).toHaveAttribute('maxlength', '50')
    expect(screen.getByLabelText(/ワークスペースID/)).toHaveAttribute('maxlength', '50')
    expect(screen.getByLabelText('チャンネル名（任意）')).toHaveAttribute('maxlength', '200')
  })

  it('サーバーが返した各フィールドのエラーを表示する', async () => {
    createBindingAction.mockResolvedValue({
      ok: false,
      error: '入力内容を確認してください',
      fieldErrors: {
        slackChannelId: 'チャンネルIDの形式が正しくありません',
        slackTeamId: 'ワークスペースIDは必須です',
        personId: '生徒を選択してください',
      },
    })
    const user = userEvent.setup()
    render(<BindingForm persons={persons} />)
    await fillRequired(user)

    await submitViaConfirm(user)

    expect(await screen.findByText('チャンネルIDの形式が正しくありません')).toBeInTheDocument()
    expect(screen.getByText('ワークスペースIDは必須です')).toBeInTheDocument()
    expect(screen.getByText('生徒を選択してください')).toBeInTheDocument()
  })

  it('保存成功後は submit を無効のままにする（二重登録の防止）', async () => {
    const user = userEvent.setup()
    render(<BindingForm persons={persons} />)
    await fillRequired(user)

    await submitViaConfirm(user)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/channels'))

    expect(screen.getByRole('button', { name: '紐付ける' })).toBeDisabled()
  })
})

describe('BindingForm（確定前の確認ダイアログ）', () => {
  it('生徒名とチャンネル名を出して、何が起きるかを説明する', async () => {
    const user = userEvent.setup()
    render(<BindingForm persons={persons} reports={reports} />)
    await fillRequired(user)
    await user.type(screen.getByLabelText('チャンネル名（任意）'), 'study-taro')

    await user.click(screen.getByRole('button', { name: '紐付ける' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('この生徒に紐付けますか？')
    expect(dialog).toHaveTextContent('#study-taro')
    expect(dialog).toHaveTextContent('山田太郎')
    expect(dialog).toHaveTextContent('この生徒の学習履歴とレポートが使われます')
    // 確認しただけでは送信しない
    expect(createBindingAction).not.toHaveBeenCalled()
  })

  it('チャンネル名が未入力ならチャンネルIDを出す（何に紐付けるかを必ず示す）', async () => {
    const user = userEvent.setup()
    render(<BindingForm persons={persons} reports={reports} />)
    await fillRequired(user)

    await user.click(screen.getByRole('button', { name: '紐付ける' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('C01ABCDEFGH')
  })

  it('選んだ生徒がそのまま確認文に出る（取り違えに気づける）', async () => {
    const user = userEvent.setup()
    render(<BindingForm persons={persons} reports={reports} />)
    await user.type(screen.getByLabelText(/SlackチャンネルID/), 'C01ABCDEFGH')
    await user.type(screen.getByLabelText(/ワークスペースID/), 'T01ABCDEFGH')
    await user.click(screen.getByLabelText(/生徒/))
    await user.click(await screen.findByRole('option', { name: '佐藤花子' }))

    await user.click(screen.getByRole('button', { name: '紐付ける' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('佐藤花子')
    expect(dialog).not.toHaveTextContent('山田太郎')
  })

  it('キャンセルすると送信されない', async () => {
    const user = userEvent.setup()
    render(<BindingForm persons={persons} reports={reports} />)
    await fillRequired(user)

    await user.click(screen.getByRole('button', { name: '紐付ける' }))
    await user.click(await screen.findByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(createBindingAction).not.toHaveBeenCalled()
  })

  it('確定すると入力どおりの FormData で送信される', async () => {
    const user = userEvent.setup()
    render(<BindingForm persons={persons} reports={reports} />)
    await fillRequired(user)
    await user.type(screen.getByLabelText('チャンネル名（任意）'), 'study-taro')

    await submitViaConfirm(user)

    await waitFor(() => expect(createBindingAction).toHaveBeenCalledTimes(1))
    const fd = createBindingAction.mock.calls[0][1] as FormData
    expect(fd.get('slackChannelId')).toBe('C01ABCDEFGH')
    expect(fd.get('slackChannelName')).toBe('study-taro')
    expect(fd.get('personId')).toBe(persons[0].id)
  })
})
