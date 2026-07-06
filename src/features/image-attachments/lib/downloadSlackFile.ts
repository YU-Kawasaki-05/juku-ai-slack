/** @file
 * 機能: Slack の url_private から Bot token で画像をダウンロードする
 * 入力: urlPrivate, botToken
 * 出力: { bytes: Uint8Array, contentType }
 * 例外: サイズ超過は ImageTooLargeError、取得失敗は SlackFileDownloadFailedError
 * 依存: fetch
 * 副作用: Slack への GET
 * セキュリティ: Bot token は slack.com 系ホストにのみ送る（allowlist）。リダイレクトは追従しない
 *   （別ホストへのトークン漏洩/SSRF 防止）。実バイト数も上限チェック
 * @implements FR-06, BR-06-03, BR-06-04, AC-06-01
 */
import { MAX_IMAGE_BYTES } from '@shared/lib/constants'
import { SlackFileDownloadFailedError, ImageTooLargeError } from '@shared/lib/errors/AppError'

export interface DownloadedFile {
  bytes: Uint8Array
  contentType: string
}

/** slack.com / *.slack.com のみ許可（Bot token をそれ以外へ送らない） */
function isSlackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'slack.com' || h.endsWith('.slack.com')
}

export async function downloadSlackFile(
  urlPrivate: string,
  botToken: string,
): Promise<DownloadedFile> {
  let url: URL
  try {
    url = new URL(urlPrivate)
  } catch {
    throw new SlackFileDownloadFailedError('invalid url')
  }
  if (url.protocol !== 'https:' || !isSlackHost(url.hostname)) {
    // Bot token を Slack 以外のホストに送らない（SSRF/トークン漏洩防止）
    throw new SlackFileDownloadFailedError(`disallowed host: ${url.hostname}`)
  }

  let res: Response
  try {
    res = await fetch(urlPrivate, {
      headers: { Authorization: `Bearer ${botToken}` },
      redirect: 'manual', // 別ホストへのリダイレクトにトークンを持ち回らない
    })
  } catch (err) {
    throw new SlackFileDownloadFailedError(err)
  }

  // リダイレクトは追従しない（opaqueredirect または 3xx を失敗扱い）
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new SlackFileDownloadFailedError(`unexpected redirect (status ${res.status})`)
  }
  if (!res.ok) {
    throw new SlackFileDownloadFailedError(`status ${res.status}`)
  }

  const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
  // Slack は認証エラー時に HTML を返すことがある。画像でなければ失敗扱い
  if (!contentType.startsWith('image/')) {
    throw new SlackFileDownloadFailedError(`unexpected content-type: ${contentType}`)
  }

  // Content-Length があれば読み込み前に上限チェック（BR-06-03）
  const declaredLen = Number(res.headers.get('content-length'))
  if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_BYTES) {
    throw new ImageTooLargeError(declaredLen)
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  // 実バイト数でも上限チェック（Content-Length 欠落/詐称対策）
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageTooLargeError(bytes.byteLength)
  }

  return { bytes, contentType }
}

/** バイト列を data URL に変換（Vision モデル入力用） */
export function toDataUrl(bytes: Uint8Array, mimetype: string): string {
  const base64 = Buffer.from(bytes).toString('base64')
  return `data:${mimetype};base64,${base64}`
}
