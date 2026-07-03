/** @file
 * 機能: slack_event_receipts への記録による重複イベント検出
 * 入力: Supabase クライアント, イベント情報
 * 出力: 'new' | 'duplicate'
 * 例外: unique 制約違反以外の DB エラーは上位に伝播
 * 依存: slack_event_receipts テーブル（unique event_id）
 * 副作用: 行の挿入
 * セキュリティ: なし
 * @implements FR-01, AC-01-04
 */
import type { ServerDb } from '@shared/types/db'

/** Postgres unique_violation */
const PG_UNIQUE_VIOLATION = '23505'

export interface RecordReceiptParams {
  eventId: string
  teamId: string
  eventType: string
  eventTs?: string | null
}

/**
 * event_id を記録する。既存なら 'duplicate'（BR-01-03）。
 * unique 制約により、同時到達でも 1 件だけが 'new' になる。
 */
export async function recordEventReceipt(
  db: ServerDb,
  params: RecordReceiptParams,
): Promise<'new' | 'duplicate'> {
  const { error } = await db.from('slack_event_receipts').insert({
    event_id: params.eventId,
    slack_team_id: params.teamId,
    event_type: params.eventType,
    event_ts: params.eventTs ?? null,
    status: 'received',
  })

  if (!error) return 'new'
  if (error.code === PG_UNIQUE_VIOLATION) return 'duplicate'
  throw error
}
