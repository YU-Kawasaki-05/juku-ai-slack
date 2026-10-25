/** @file
 * 機能: Vercel Cron の呼び出し認証（Authorization: Bearer <CRON_SECRET>）
 * 入力: Authorization ヘッダの値、期待するシークレット
 * 出力: boolean
 * 例外: なし
 * 依存: node:crypto
 * セキュリティ: シークレット未設定（空含む）のときは常に false。「未設定なら無認証で通す」
 *   fail-open にすると、設定漏れのまま公開 URL から誰でも LLM 課金とメール送信を起動できる。
 *   比較は長さが違っても同じ時間で終わるよう、SHA-256 を取ってから timingSafeEqual する
 * @implements FR-08
 */
import { createHash, timingSafeEqual } from 'node:crypto'

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function verifyCronAuth(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  const expected = secret?.trim()
  if (!expected) return false
  if (!authorizationHeader) return false
  return timingSafeEqual(sha256(authorizationHeader), sha256(`Bearer ${expected}`))
}
