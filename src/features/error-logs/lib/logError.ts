/** @file
 * 機能: ai_error_logs へのエラー記録（最小実装。FR-11 の完全版は Sprint 2）
 * 入力: Supabase クライアント, LogErrorParams
 * 出力: なし
 * 例外: 記録自体の失敗は握りつぶす（主処理を妨げない。console.error のみ）
 * 依存: ai_error_logs テーブル
 * 副作用: DB 書き込み
 * セキュリティ: internal_message は内部向け。user_facing_message のみユーザーに露出
 * @implements FR-11, FR-01, AC-01-03
 */
import type { ServerDb } from '@shared/types/db'
import type { Json } from '@shared/types/database.types'
import type { ErrorSeverity } from '@shared/lib/errors/AppError'

export interface LogErrorParams {
  code: string
  severity: ErrorSeverity
  internalMessage?: string
  userFacingMessage?: string
  personId?: string | null
  channelId?: string | null
  threadTs?: string | null
  messageTs?: string | null
  retryable?: boolean
  rawError?: unknown
}

/** 生エラーから安全に記録するキー（provider の生エラーは request/headers に鍵を含み得るため限定） */
const RAW_ERROR_ALLOWED_KEYS = ['name', 'message', 'code', 'status'] as const

function serializeRawError(raw: unknown): Json {
  if (raw === undefined || raw === null) return null
  if (raw instanceof Error) return { name: raw.name, message: raw.message }
  if (typeof raw === 'object') {
    // 丸ごと保存せず、許可キーの primitive 値のみ抽出（Authorization ヘッダ等の混入防止）
    const src = raw as Record<string, unknown>
    const picked: Record<string, string | number | boolean> = {}
    for (const key of RAW_ERROR_ALLOWED_KEYS) {
      const v = src[key]
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        picked[key] = v
      }
    }
    return picked
  }
  return { value: String(raw) }
}

export async function logError(db: ServerDb, params: LogErrorParams): Promise<void> {
  const { error } = await db.from('ai_error_logs').insert({
    error_code: params.code,
    severity: params.severity,
    internal_message: params.internalMessage ?? null,
    user_facing_message: params.userFacingMessage ?? null,
    person_id: params.personId ?? null,
    slack_channel_id: params.channelId ?? null,
    thread_ts: params.threadTs ?? null,
    message_ts: params.messageTs ?? null,
    retryable: params.retryable ?? false,
    raw_error: serializeRawError(params.rawError),
  })

  if (error) {
    // 記録失敗は主処理を止めない
    console.error('[logError] failed to persist error log:', error.message, 'for code', params.code)
  }
}
