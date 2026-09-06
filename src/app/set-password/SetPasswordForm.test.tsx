/** @file
 * 検証: 招待リンクからのパスワード設定画面の挙動
 *   （セッション確立・フォームの出し方・「セッションが無ければ変更させない」保証）
 * @verifies FR-13
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.hoisted(() => vi.fn())
const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

const auth = vi.hoisted(() => ({
  setSession: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
}))
vi.mock('@/shared/lib/supabase/browserClient', () => ({
  getBrowserClient: () => ({ auth }),
}))

import SetPasswordForm from './SetPasswordForm'
import {
  MISMATCH_MESSAGE,
  EXPIRED_LINK_MESSAGE,
  NO_LINK_MESSAGE,
  SESSION_LOST_MESSAGE,
  WEAK_PASSWORD_MESSAGE,
} from './passwordSetup'

/** 招待リンクを開いた状態の URL を作る（jsdom の location を差し替える） */
function visit(pathWithHash: string) {
  window.history.replaceState({}, '', pathWithHash)
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.setSession.mockResolvedValue({ data: { session: {} }, error: null })
  auth.getSession.mockResolvedValue({ data: { session: { access_token: 'a' } }, error: null })
  auth.updateUser.mockResolvedValue({ data: { user: {} }, error: null })
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('SetPasswordForm', () => {
  it('有効なリンクならトークンでセッションを張り、フラグメントを URL から消す', async () => {
    visit('/set-password#access_token=AAA&refresh_token=BBB&type=recovery')
    render(<SetPasswordForm />)

    expect(await screen.findByLabelText('新しいパスワード')).toBeInTheDocument()
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'AAA', refresh_token: 'BBB' })
    expect(window.location.hash).toBe('')
  })

  it('StrictMode（next dev の既定）でも「確認中」で止まらずフォームが出る', async () => {
    visit('/set-password#access_token=AAA&refresh_token=BBB&type=recovery')
    render(
      <StrictMode>
        <SetPasswordForm />
      </StrictMode>,
    )

    expect(await screen.findByLabelText('新しいパスワード')).toBeInTheDocument()
    // effect が 2 回走ってもセッション確立は 1 回だけ
    expect(auth.setSession).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('リンクを確認しています...')).not.toBeInTheDocument()
  })

  it('期限切れリンクはフォームを出さず、日本語で再発行を案内する', async () => {
    visit('/set-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    render(<SetPasswordForm />)

    expect(await screen.findByText(EXPIRED_LINK_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByLabelText('新しいパスワード')).not.toBeInTheDocument()
    expect(auth.setSession).not.toHaveBeenCalled()
  })

  it('トークンもセッションも無い直アクセスはフォームを出さない', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    visit('/set-password')
    render(<SetPasswordForm />)

    expect(await screen.findByText(NO_LINK_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByLabelText('新しいパスワード')).not.toBeInTheDocument()
  })

  it('リロード後（フラグメント消失）でもセッションが残っていればフォームを出す', async () => {
    visit('/set-password')
    render(<SetPasswordForm />)

    expect(await screen.findByLabelText('新しいパスワード')).toBeInTheDocument()
    expect(auth.setSession).not.toHaveBeenCalled()
  })

  it('setSession が失敗したら期限切れとして案内する', async () => {
    auth.setSession.mockResolvedValue({ data: { session: null }, error: { code: 'otp_expired' } })
    visit('/set-password#access_token=AAA&refresh_token=BBB&type=recovery')
    render(<SetPasswordForm />)

    expect(await screen.findByText(EXPIRED_LINK_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByLabelText('新しいパスワード')).not.toBeInTheDocument()
  })

  it('2 回入力が一致していれば更新して /admin へ遷移する', async () => {
    visit('/set-password#access_token=AAA&refresh_token=BBB&type=recovery')
    render(<SetPasswordForm />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('新しいパスワード'), 'Passw0rd!new')
    await user.type(screen.getByLabelText('新しいパスワード（確認）'), 'Passw0rd!new')
    await user.click(screen.getByRole('button', { name: 'パスワードを設定する' }))

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Passw0rd!new' }))
    expect(push).toHaveBeenCalledWith('/admin')
  })

  it('不一致なら更新を呼ばずにエラーを出す', async () => {
    visit('/set-password#access_token=AAA&refresh_token=BBB&type=recovery')
    render(<SetPasswordForm />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('新しいパスワード'), 'Passw0rd!new')
    await user.type(screen.getByLabelText('新しいパスワード（確認）'), 'Passw0rd!NEW')
    await user.click(screen.getByRole('button', { name: 'パスワードを設定する' }))

    expect(await screen.findByText(MISMATCH_MESSAGE)).toBeInTheDocument()
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('セキュリティ: 送信直前にセッションが無ければ updateUser を呼ばない', async () => {
    visit('/set-password#access_token=AAA&refresh_token=BBB&type=recovery')
    render(<SetPasswordForm />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('新しいパスワード'), 'Passw0rd!new')
    await user.type(screen.getByLabelText('新しいパスワード（確認）'), 'Passw0rd!new')
    // リンクのセッションが失われた状態を作る
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await user.click(screen.getByRole('button', { name: 'パスワードを設定する' }))

    expect(await screen.findByText(SESSION_LOST_MESSAGE)).toBeInTheDocument()
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('更新失敗時は入力をクリアして日本語のエラーを出す（遷移しない）', async () => {
    auth.updateUser.mockResolvedValue({ data: { user: null }, error: { code: 'weak_password' } })
    visit('/set-password#access_token=AAA&refresh_token=BBB&type=recovery')
    render(<SetPasswordForm />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('新しいパスワード'), 'Passw0rd!new')
    await user.type(screen.getByLabelText('新しいパスワード（確認）'), 'Passw0rd!new')
    await user.click(screen.getByRole('button', { name: 'パスワードを設定する' }))

    expect(await screen.findByText(WEAK_PASSWORD_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('新しいパスワード')).toHaveValue('')
    expect(push).not.toHaveBeenCalled()
  })
})
