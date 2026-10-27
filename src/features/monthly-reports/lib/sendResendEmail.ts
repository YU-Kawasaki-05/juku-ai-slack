/** @file
 * 機能: Resend の HTTP API（POST /emails）でメールを 1 通送る。添付ファイル対応
 * 入力: apiKey, from, to[], subject, text, attachments[]、Idempotency-Key
 * 出力: { ok: true } または { ok: false, error }（throw しない）
 * 例外: なし（HTTP 層の失敗・タイムアウト・非 2xx も { ok:false } に正規化）
 * 依存: fetch（30 秒タイムアウト）。npm パッケージは使わない
 * 副作用: 外部へのメール送信
 * セキュリティ: API キーは Authorization ヘッダにだけ載せ、エラー文言にもログにも出さない。
 *   Resend の Idempotency-Key（24 時間有効）を付け、再試行や同時実行でも同じ月のメールが重複しないようにする
 * @implements FR-08
 */
import { RESEND_TIMEOUT_MS } from '@shared/lib/constants'

const RESEND_API_URL = 'https://api.resend.com/emails'

export interface EmailAttachment {
  filename: string
  /** ファイル本文（UTF-8 のテキスト）。送信時に base64 化する */
  content: string
}

export interface EmailMessage {
  from: string
  to: string[]
  subject: string
  text: string
  attachments: EmailAttachment[]
}

export type EmailResult = { ok: true } | { ok: false; error: string }

export interface SendResendEmailParams extends EmailMessage {
  apiKey: string
  idempotencyKey?: string
  /** テスト用の差し替え口 */
  fetchImpl?: typeof fetch
}

export async function sendResendEmail(params: SendResendEmailParams): Promise<EmailResult> {
  const doFetch = params.fetchImpl ?? fetch
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
    'Content-Type': 'application/json',
  }
  if (params.idempotencyKey) headers['Idempotency-Key'] = params.idempotencyKey

  let res: Response
  try {
    res = await doFetch(RESEND_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        attachments: params.attachments.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, 'utf-8').toString('base64'),
        })),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    const timedOut = name === 'TimeoutError' || name === 'AbortError'
    return { ok: false, error: timedOut ? `Resend: タイムアウト（${RESEND_TIMEOUT_MS}ms）` : 'Resend: 接続に失敗しました' }
  }

  if (res.ok) return { ok: true }

  // エラー本文は Resend が返す {name, message}。キーを含まないが、長さは切る
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    // 本文が読めなくてもステータスだけで十分
  }
  return { ok: false, error: `Resend: HTTP ${res.status}${detail ? ` ${detail}` : ''}` }
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
/** `表示名 <addr>`（Resend の from として正しい形）。表示名に < > 改行は使えない */
const NAMED_FROM_RE = /^[^<>\r\n]+<([^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+)>$/

/** Resend の from に使える形か: `addr` または `Name <addr>` */
export function isValidFromAddress(value: string | null | undefined): boolean {
  const v = value?.trim()
  if (!v) return false
  return EMAIL_RE.test(v) || NAMED_FROM_RE.test(v)
}
/** Resend の宛先上限 */
const MAX_RECIPIENTS = 50

/**
 * REPORT_EMAIL_TO（カンマ・セミコロン・空白・改行区切り）から有効な宛先だけを取り出す。
 * 形式が不正なものは捨てる（env の検証で落とさず、「宛先なし」として扱うため）
 */
export function parseRecipients(raw: string | null | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const part of raw.split(/[,;\s]+/)) {
    const addr = part.trim()
    if (addr && EMAIL_RE.test(addr)) seen.add(addr)
  }
  return Array.from(seen).slice(0, MAX_RECIPIENTS)
}
