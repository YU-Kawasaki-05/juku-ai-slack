/** @file
 * 機能: 招待リンク（Supabase recovery リンク）の解釈・入力検証・エラーメッセージ
 * 入力: 招待リンクを開いた URL / 入力されたパスワード / Supabase の AuthError
 * 出力: 判定結果と画面に出す日本語メッセージ
 * 依存: なし（純関数のみ。React も Supabase SDK も import しない）
 * 備考: E2E（e2e/set-password.spec.ts）からも文言を参照するため、
 *   コンポーネントから切り出して依存ゼロのモジュールにしている
 * @implements FR-13
 */

/**
 * 最低文字数。FR-13 の要件（8 文字以上）に合わせ、supabase/config.toml の
 * `minimum_password_length` も 8 にしてある。
 * ここを Supabase 側の設定より**緩く**すると「入力は通ったのに保存で 422」になるため、
 * 常に「Supabase の設定 <= この値」に保つこと。
 */
export const MIN_PASSWORD_LENGTH = 8

export const MISMATCH_MESSAGE = 'パスワードが一致しません。2 つの欄に同じものを入力してください。'
export const TOO_SHORT_MESSAGE = `パスワードは ${MIN_PASSWORD_LENGTH} 文字以上にしてください。`
export const EXPIRED_LINK_MESSAGE =
  'リンクの有効期限が切れています（発行から 1 時間、かつ 1 回限り有効）。管理者に再発行を依頼してください。'
export const INVALID_LINK_MESSAGE =
  'リンクが無効です。すでに使用済みか、URL が途中で切れている可能性があります。管理者に再発行を依頼してください。'
export const NO_LINK_MESSAGE =
  'このページは招待リンクから開く必要があります。管理者から届いたリンクを開き直してください。'
export const SESSION_LOST_MESSAGE =
  'リンクの認証が失われました。管理者に再発行を依頼し、届いたリンクを開き直してください。'
export const UPDATE_FAILED_MESSAGE =
  'パスワードの設定に失敗しました。時間をおいて再度お試しください。'
export const WEAK_PASSWORD_MESSAGE =
  `パスワードが強度の条件を満たしていません。${MIN_PASSWORD_LENGTH} 文字以上で、推測されにくい文字列にしてください。`
export const SAME_PASSWORD_MESSAGE =
  '現在と同じパスワードは設定できません。別のパスワードを入力してください。'
export const RATE_LIMITED_MESSAGE =
  '短時間に操作が集中しました。1 分ほど待ってから再度お試しください。'

/** 招待リンクを開いたときに URL から取り出せるもの */
export type RecoveryLink =
  /** セッションを確立できるトークンが載っていた */
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  /** Supabase が「無効・期限切れ」として返してきた */
  | { kind: 'error'; errorCode: string | null }
  /** 何も載っていない（直接 URL を叩いた / 一度読み取ってフラグメントを消した後の再描画） */
  | { kind: 'none' }

/**
 * 招待リンクの URL を解釈する。
 *
 * Supabase の `/auth/v1/verify` は 303 で
 *   成功: `<redirect_to>#access_token=...&refresh_token=...&type=recovery`
 *   失敗: `<redirect_to>#error=access_denied&error_code=otp_expired&error_description=...`
 * を返す。**どちらもフラグメント**なのでサーバーからは読めず、ここで解釈する必要がある。
 *
 * トークンはフラグメントからのみ読む（クエリからは読まない）。エラー系は将来 Supabase が
 * クエリに載せてきても取りこぼさないよう両方見る（機密ではないため）。
 */
export function parseRecoveryLink(href: string): RecoveryLink {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  const fromEither = (key: string) => hash.get(key) ?? url.searchParams.get(key)

  if (fromEither('error') || fromEither('error_code') || fromEither('error_description')) {
    return { kind: 'error', errorCode: fromEither('error_code') }
  }

  const accessToken = hash.get('access_token')
  const refreshToken = hash.get('refresh_token')
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken }

  return { kind: 'none' }
}

/** Supabase がフラグメントで返す error_code を日本語にする */
export function toRecoveryLinkErrorMessage(errorCode: string | null): string {
  // 「期限切れ」「使用済み」「存在しないトークン」はすべて otp_expired で返ってくる（実測）。
  // 3 つを区別する情報は Supabase から返らないので、有効期限と 1 回限りの両方を案内する
  if (errorCode === 'otp_expired') return EXPIRED_LINK_MESSAGE
  // それ以外（error_code 無し / server_error など）は原因を断定せず再発行を促す
  return INVALID_LINK_MESSAGE
}

/** 入力の検証。問題なければ null */
export function validateNewPassword(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return TOO_SHORT_MESSAGE
  if (password !== confirmation) return MISMATCH_MESSAGE
  return null
}

/** 判定に使う最小形（Supabase の AuthError を満たす） */
export interface UpdatePasswordError {
  code?: string
  status?: number
  name?: string
}

/** updateUser 失敗を日本語にする。原因が「リンク側」なら再発行を促す */
export function toUpdatePasswordErrorMessage(authError: UpdatePasswordError): string {
  switch (authError.code) {
    case 'weak_password':
      return WEAK_PASSWORD_MESSAGE
    case 'same_password':
      return SAME_PASSWORD_MESSAGE
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return RATE_LIMITED_MESSAGE
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'session_expired':
    case 'user_not_found':
      return SESSION_LOST_MESSAGE
    default:
      break
  }
  // code を持たない場合のフォールバック: 401/403 はセッション側の失効
  if (authError.status === 401 || authError.status === 403) return SESSION_LOST_MESSAGE
  return UPDATE_FAILED_MESSAGE
}
