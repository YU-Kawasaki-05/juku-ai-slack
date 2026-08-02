/** @file
 * 機能: failed ジョブの再実行準備（二重返信ガード付き）
 * 入力: Supabase クライアント（Service Role）, jobId, 基準時刻
 * 出力: RetryJobOutcome（requeued のときだけ呼び出し側が processJob を起動する）
 * 例外: DB エラーは上位に伝播
 * 依存: jobs, slack_messages
 * 副作用: jobs の status 更新（pending 差し戻し or completed 確定）
 * セキュリティ: 呼び出し側（Server Action）で requireStaff 済みであること
 * @implements FR-04, F-4, A-3（生成と配信の分離）
 *
 * 二重返信ガード:
 *   「投稿には成功したが直後に kill された」ジョブを素朴に再実行すると同じ回答を 2 通送ってしまう。
 *   再実行の前に slack_messages を引き、同一スレッドに「質問（message_ts）より後の assistant 行」が
 *   あれば配信済みとみなして再実行せず completed に確定する。
 *   誤判定の向きは意図的に安全側へ倒してある:
 *     - 空振り（実際は未配信なのに「配信済み」と判定）: 失敗後に同じスレッドで別の質問が
 *       回答されていると起きる。生徒は再質問すればよく、二重返信より軽い。
 *     - 危険側（配信済みなのに「未配信」と判定）: assistant 行は投稿成功後にしか書かれないため、
 *       投稿直後〜行保存前に kill された極小の窓でしか起きない。
 *   その窓に当たった場合でも result_text が残っていれば LLM の再課金は起きない（A-3）。
 */
import type { ServerDb } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'
import { processSlackMessagePayloadSchema } from '../types'

export type RetryJobOutcome =
  | { kind: 'not_found' }
  /** failed 以外は再実行しない（processing 中のジョブを横取りしない） */
  | { kind: 'not_retryable'; status: string }
  | { kind: 'invalid_payload' }
  /** 配信済みを検知したので再実行せず completed に確定した */
  | { kind: 'already_delivered' }
  /** 状態が変わっており CAS に失敗した（他の操作と競合） */
  | { kind: 'conflict' }
  /** pending に差し戻した。呼び出し側が processJob を起動する */
  | { kind: 'requeued' }

interface JobRow {
  id: string
  status: string
  payload: unknown
}

/** 同一スレッドに「この質問より後の assistant 発言」があるか（= 既に返信済みか） */
async function hasAssistantReply(
  db: ServerDb,
  channelId: string,
  threadTs: string,
  questionTs: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('slack_messages')
    .select('id')
    .eq('slack_channel_id', channelId)
    .eq('thread_ts', threadTs)
    .eq('role', 'assistant')
    // Slack ts は固定桁のゼロ埋め数値文字列なので辞書順比較で時系列比較になる。
    // 投稿 ts が取れなかったときの `${messageTs}-ai` も接頭辞が同じぶん後ろに並ぶ
    .gt('message_ts', questionTs)
    .limit(1)
  if (error) throw queryError('retryJob.hasAssistantReply', error)
  return (data ?? []).length > 0
}

export async function retryJob(
  db: ServerDb,
  jobId: string,
  now: Date = new Date(),
): Promise<RetryJobOutcome> {
  const nowIso = now.toISOString()

  const { data: job, error: selectError } = await db
    .from('jobs')
    .select('id, status, payload')
    .eq('id', jobId)
    .maybeSingle()
  if (selectError) throw queryError('retryJob.select', selectError)
  if (!job) return { kind: 'not_found' }

  const row = job as JobRow
  if (row.status !== 'failed') return { kind: 'not_retryable', status: row.status }

  const parsed = processSlackMessagePayloadSchema.safeParse(row.payload)
  if (!parsed.success) return { kind: 'invalid_payload' }
  const payload = parsed.data

  if (await hasAssistantReply(db, payload.channelId, payload.threadTs, payload.messageTs)) {
    // error_code は監査のため残す（「タイムアウト扱いだが配信は確認済み」と読めるようにする）
    const { data, error } = await db
      .from('jobs')
      .update({ status: 'completed', finished_at: nowIso })
      .eq('id', jobId)
      .eq('status', 'failed')
      .select('id')
    if (error) throw queryError('retryJob.markDelivered', error)
    if (!data || data.length === 0) return { kind: 'conflict' }
    return { kind: 'already_delivered' }
  }

  // result_text はあえて消さない。生成済みならリトライは配信のみで完了する（A-3）
  const { data, error } = await db
    .from('jobs')
    .update({
      status: 'pending',
      attempt_count: 0,
      started_at: null,
      finished_at: null,
      error_code: null,
      scheduled_at: nowIso,
    })
    .eq('id', jobId)
    .eq('status', 'failed')
    .select('id')
  if (error) throw queryError('retryJob.requeue', error)
  if (!data || data.length === 0) return { kind: 'conflict' }
  return { kind: 'requeued' }
}
