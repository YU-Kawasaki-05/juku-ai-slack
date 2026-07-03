/** @file
 * 機能: jobs テーブルへの process_slack_message ジョブ登録
 * 入力: Supabase クライアント, ProcessSlackMessagePayload, maxAttempts?
 * 出力: 登録したジョブの id
 * 例外: DB エラーは上位に伝播
 * 依存: jobs テーブル
 * 副作用: 行の挿入（status='pending'）
 * セキュリティ: payload に raw body を含めない（BR-04-05。型で保証）
 * @implements FR-04, AC-04-01
 */
import type { ServerDb } from '@shared/types/db'
import { DEFAULT_MAX_ATTEMPTS, JOB_TYPE_PROCESS_MESSAGE } from '@shared/lib/constants'
import type { ProcessSlackMessagePayload } from '../types'

export async function enqueueJob(
  db: ServerDb,
  payload: ProcessSlackMessagePayload,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<string> {
  const { data, error } = await db
    .from('jobs')
    .insert({
      job_type: JOB_TYPE_PROCESS_MESSAGE,
      status: 'pending',
      payload,
      max_attempts: maxAttempts,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}
