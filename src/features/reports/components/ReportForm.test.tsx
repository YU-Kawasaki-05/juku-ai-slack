/** @file
 * 検証: レポートフォームの暗黙 submit が「承認して保存」にならないこと（H-2）、二重送信防止（H-9）、
 *   Slack 送信（AC-08-02）が未実装であることを踏まえた文言・表示
 * @verifies FR-16, H-2, H-9, AC-08-02
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

import { ReportForm } from './ReportForm'
import type { ReportWithPerson } from '../lib/getReports'
import type { ReportSaveResult } from '../actions/reportActions'
import type { ActionResult } from '@shared/types/action'

type ReportAction = (
  prev: ActionResult<ReportSaveResult> | undefined,
  fd: FormData,
) => Promise<ActionResult<ReportSaveResult>>

/** ReportForm の action シグネチャに合わせた型付きモック */
function mockAction(result: ActionResult<ReportSaveResult>) {
  return vi.fn<ReportAction>(async () => result)
}

const report = {
  id: '11111111-1111-4111-8111-111111111111',
  person_id: '22222222-2222-4222-8222-222222222222',
  report_month: '2026-06-01',
  title: '6月レポート',
  body_markdown: '本文',
  status: 'draft',
  is_ai_reference: true,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  embeddings_updated_at: null,
  persons: { name: '山田太郎' },
} as unknown as ReportWithPerson

/** フォーム内の submit ボタンを DOM 順で列挙する（暗黙 submit は先頭が発火する） */
function submitButtons(): HTMLButtonElement[] {
  const form = document.querySelector('form')!
  return Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))
}

beforeEach(() => vi.clearAllMocks())

describe('ReportForm（H-2: Enter キーで承認保存が発火しない）', () => {
  it('フォーム内で最初に現れる submit は draft（＝暗黙 submit は下書き保存）', () => {
    render(<ReportForm action={vi.fn()} report={report} />)
    const buttons = submitButtons()
    expect(buttons.length).toBeGreaterThanOrEqual(3)
    expect(buttons[0].value).toBe('draft')
    // 承認は必ず draft より後ろ
    const approvedIndex = buttons.findIndex((b) => b.value === 'approved')
    expect(approvedIndex).toBeGreaterThan(0)
  })

  it('先頭の draft ボタンは支援技術・タブ順から隠されている（見た目は変わらない）', () => {
    render(<ReportForm action={vi.fn()} report={report} />)
    const first = submitButtons()[0]
    expect(first).toHaveAttribute('aria-hidden', 'true')
    expect(first.tabIndex).toBe(-1)
  })

  it('タイトル欄で Enter を押すと status=draft が送信される', async () => {
    const action = mockAction({ ok: true })
    render(<ReportForm action={action} report={report} />)

    await userEvent.click(screen.getByLabelText(/タイトル/))
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(action).toHaveBeenCalled())
    const fd = action.mock.calls[0][1]
    expect(fd.get('status')).toBe('draft')
  })
})

describe('ReportForm（H-9: 二重送信防止）', () => {
  it('保存成功後は submit ボタンが無効のままになる', async () => {
    const action = mockAction({ ok: true })
    render(<ReportForm action={action} report={report} />)

    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/reports'))

    expect(screen.getByRole('button', { name: '承認して保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下書き保存' })).toBeDisabled()
  })

  it('保存失敗時は再送信できる（無効化しない）', async () => {
    const action = mockAction({ ok: false, error: '保存に失敗しました' })
    render(<ReportForm action={action} report={report} />)

    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }))
    await screen.findByText('保存に失敗しました')

    expect(screen.getByRole('button', { name: '下書き保存' })).toBeEnabled()
  })
})

describe('ReportForm（H-8: fieldErrors の描画）', () => {
  it('サーバーが返した各フィールドのエラーを表示する', async () => {
    const action = mockAction({
      ok: false,
      error: '入力内容を確認してください',
      fieldErrors: { title: 'タイトルは必須です', bodyMarkdown: '本文が長すぎます' },
    })
    render(<ReportForm action={action} report={report} />)

    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }))

    expect(await screen.findByText('タイトルは必須です')).toBeInTheDocument()
    expect(screen.getByText('本文が長すぎます')).toBeInTheDocument()
    expect(screen.getByLabelText(/タイトル/)).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('ReportForm（AC-08-02 未実装: Slack 送信と誤認させない）', () => {
  it('承認の説明では Slack 送信が起きないことを明示する', () => {
    render(<ReportForm action={vi.fn()} report={report} />)

    expect(screen.getByText(/生徒への Slack 送信は行いません/)).toBeInTheDocument()
    expect(screen.queryByText(/Slack 送信の対象/)).not.toBeInTheDocument()
  })

  it('AI 参照の説明に「送信済み」を含めない', () => {
    render(<ReportForm action={vi.fn()} report={report} />)

    expect(screen.getByText('オンにすると、承認済みのレポートを Bot が回答時に参照します')).toBeInTheDocument()
  })

  // status='sent' を書き込む処理が無いので実際には出ないが、バナーを消したことを固定する
  it('status=sent でも「Slack 送信済み」バナーを出さない', () => {
    render(<ReportForm action={vi.fn()} report={{ ...report, status: 'sent' }} />)

    expect(screen.queryByText(/Slack 送信済み/)).not.toBeInTheDocument()
  })
})
