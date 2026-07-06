/** @file
 * 機能: Slack の url_private から Bot token で画像をダウンロードする
 * 入力: urlPrivate, botToken
 * 出力: { bytes: Uint8Array, contentType }
 * 例外: 取得失敗は SlackFileDownloadFailedError
 * 依存: fetch
 * 副作用: Slack への GET
 * セキュリティ: Bot token は Authorization ヘッダのみ。url_private は Slack 内部URL
 * @implements FR-06, BR-06-04, AC-06-01
 */
import { SlackFileDownloadFailedError } from '@shared/lib/errors/AppError'

export interface DownloadedFile {
  bytes: Uint8Array
  contentType: string
}

export async function downloadSlackFile(
  urlPrivate: string,
  botToken: string,
): Promise<DownloadedFile> {
  let res: Response
  try {
    res = await fetch(urlPrivate, { headers: { Authorization: `Bearer ${botToken}` } })
  } catch (err) {
    throw new SlackFileDownloadFailedError(err)
  }
  if (!res.ok) {
    throw new SlackFileDownloadFailedError(`status ${res.status}`)
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
  // Slack は認証エラー時に HTML を返すことがある。画像でなければ失敗扱い
  if (!contentType.startsWith('image/')) {
    throw new SlackFileDownloadFailedError(`unexpected content-type: ${contentType}`)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  return { bytes: buf, contentType }
}

/** バイト列を data URL に変換（Vision モデル入力用） */
export function toDataUrl(bytes: Uint8Array, mimetype: string): string {
  const base64 = Buffer.from(bytes).toString('base64')
  return `data:${mimetype};base64,${base64}`
}
