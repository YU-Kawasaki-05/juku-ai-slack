/** @file
 * 検証: 対象月フィルタのローカル state 化とデバウンス（H-13: 入力ちらつきの解消）と、
 *   到達しない状態（sent）を選択肢に出さないこと
 * 備考: input[type=month] は文字単位のタイプではなく change で値が確定するため fireEvent.change を使う
 * @verifies FR-16, H-13, AC-08-02
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }))

import { ReportsFilter } from './ReportsFilter'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

function monthInput(): HTMLInputElement {
  return screen.getByLabelText('対象月') as HTMLInputElement
}

function tick(ms: number) {
  return act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

describe('ReportsFilter の月入力', () => {
  it('入力直後はサーバー往復せず、入力値はローカル state で保持される', async () => {
    render(<ReportsFilter persons={[]} value={{}} />)

    fireEvent.change(monthInput(), { target: { value: '2026-06' } })

    expect(monthInput().value).toBe('2026-06')
    expect(replace).not.toHaveBeenCalled()
  })

  it('入力が止まってから URL を1回だけ更新する', async () => {
    render(<ReportsFilter persons={[]} value={{}} />)

    fireEvent.change(monthInput(), { target: { value: '2026-06' } })
    await tick(400)

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/admin/reports?month=2026-06')
  })

  it('連続入力ではデバウンスがまとめられ、最後の値だけが URL に出る', async () => {
    render(<ReportsFilter persons={[]} value={{}} />)

    fireEvent.change(monthInput(), { target: { value: '2026-05' } })
    await tick(100)
    fireEvent.change(monthInput(), { target: { value: '2026-06' } })
    await tick(400)

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/admin/reports?month=2026-06')
  })

  it('親から渡る value が変わればローカル state も追従する（クリア・戻る操作）', () => {
    const { rerender } = render(<ReportsFilter persons={[]} value={{ month: '2026-06' }} />)
    expect(monthInput().value).toBe('2026-06')

    rerender(<ReportsFilter persons={[]} value={{}} />)
    expect(monthInput().value).toBe('')
  })

  it('クリアは保留中のデバウンスを取り消してフィルタなしに戻す', async () => {
    render(<ReportsFilter persons={[]} value={{ month: '2026-06' }} />)

    fireEvent.change(monthInput(), { target: { value: '2026-07' } })
    fireEvent.click(screen.getByRole('button', { name: /クリア/ }))
    await tick(400)

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/admin/reports')
  })
})

describe('ReportsFilter の状態フィルタ', () => {
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
  // Radix の開閉は実時間のタイマーに乗るため、この describe だけ偽タイマーを外す
  beforeEach(() => vi.useRealTimers())

  it('「送信済み」は選択肢に出さない（Slack 送信が未実装で該当データが存在しない）', async () => {
    const user = userEvent.setup()
    render(<ReportsFilter persons={[]} value={{}} />)

    await user.click(screen.getByLabelText('状態'))

    expect(await screen.findByRole('option', { name: '承認済み' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '下書き' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '送信済み' })).not.toBeInTheDocument()
  })
})
