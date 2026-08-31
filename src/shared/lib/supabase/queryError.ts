/** @file
 * 機能: Supabase クエリエラーを文脈付き Error に変換する
 * 背景: PostgrestError をそのまま throw すると、message が空のとき
 *   Next.js のログに `[Error: {"message":""}]` としか出ず原因追跡が不可能になる。
 *   特に head:true（HEAD リクエスト）は応答 body が無く、エラー時に全フィールドが
 *   空になるため、HTTP ステータスと raw JSON も必ず message に含める
 * @implements -
 */
interface QueryErrorLike {
  message?: string
  code?: string
  details?: string
  hint?: string
}

interface ResponseInfo {
  status?: number
  statusText?: string
}

export function queryError(context: string, error: QueryErrorLike, res?: ResponseInfo): Error {
  const parts = [
    `Supabase query failed: ${context}`,
    error.message && `message=${error.message}`,
    error.code && `code=${error.code}`,
    error.details && `details=${error.details}`,
    error.hint && `hint=${error.hint}`,
    res?.status !== undefined && `http=${res.status}${res.statusText ? ` ${res.statusText}` : ''}`,
    `raw=${JSON.stringify(error)}`,
  ].filter(Boolean)
  return new Error(parts.join(' | '), { cause: error })
}
