/** @file
 * 機能: ジョブの claim・実行・リトライ・状態更新・🤔リアクション制御
 * 入力: Supabase クライアント, jobId, options（テスト用の依存注入）
 * 出力: 処理結果 { status }
 * 例外: claim 時の DB エラーのみ伝播。実行失敗は内部でリトライ/failed 化
 * 依存: jobs テーブル, executeProcessSlackMessage, Slack reactions, logError
 * 副作用: jobs 行更新, Slack リアクション付与/削除, 失敗時 ai_error_logs 記録
 * セキュリティ: payload は Zod 検証。person_id は channel_id 解決済みの値のみ
 * @implements FR-04, FR-01, AC-04-02, AC-04-03, AC-04-04, AC-01-06
 */
import type { ServerDb, TablesUpdate } from '@shared/types/db'
import { addReaction, removeReaction, postMessage } from '@shared/lib/slack/client'
import { JOB_RETRY_BASE_DELAY_MS, THINKING_REACTION } from '@shared/lib/constants'
import { AppError } from '@shared/lib/errors/AppError'
import { getUserFacingMessage, isSilentError } from '@shared/lib/errors/userMessages'
import { logError } from '@features/error-logs'
import { processSlackMessagePayloadSchema, type ProcessSlackMessagePayload } from '../types'
import { executeProcessSlackMessage } from './executeProcessMessage'

export type ProcessJobStatus = 'completed' | 'failed' | 'skipped' | 'invalid'

export interface ProcessJobResult {
  status: ProcessJobStatus
  attempts?: number
}

export interface ProcessJobOptions {
  execute?: (db: ServerDb, payload: ProcessSlackMessagePayload) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  clock?: () => string
  addReactionFn?: typeof addReaction
  removeReactionFn?: typeof removeReaction
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const defaultClock = (): string => new Date().toISOString()

/** リアクション操作はサイレント（BR-01-06） */
async function safeSlackCall(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch {
    // AI 処理を妨げない
  }
}

/** jobs のステータス更新。書き込み失敗は主処理を止めない（console.warn のみ） */
async function updateJobStatus(
  db: ServerDb,
  jobId: string,
  values: TablesUpdate<'jobs'>,
): Promise<void> {
  const { error } = await db.from('jobs').update(values).eq('id', jobId)
  if (error) {
    console.warn('[processJob] failed to update job status', jobId, (error as { message?: string }).message)
  }
}

/**
 * ジョブを processing に claim し（AC-04-04: 条件付き更新で二重処理防止）、
 * 実処理を max_attempts までリトライする（AC-04-03）。
 */
export async function processJob(
  db: ServerDb,
  jobId: string,
  options: ProcessJobOptions = {},
): Promise<ProcessJobResult> {
  const execute = options.execute ?? executeProcessSlackMessage
  const sleep = options.sleep ?? defaultSleep
  const clock = options.clock ?? defaultClock
  const addReactionFn = options.addReactionFn ?? addReaction
  const removeReactionFn = options.removeReactionFn ?? removeReaction

  // claim: pending のものだけを processing にする（原子的）。AC-04-02 / AC-04-04
  const { data: claimed, error: claimError } = await db
    .from('jobs')
    .update({ status: 'processing', started_at: clock() })
    .eq('id', jobId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle()

  if (claimError) throw claimError
  if (!claimed) return { status: 'skipped' } // 既に別処理が claim 済み

  const parsed = processSlackMessagePayloadSchema.safeParse(claimed.payload)
  if (!parsed.success) {
    await updateJobStatus(db, jobId, {
      status: 'failed',
      finished_at: clock(),
      error_code: 'UNKNOWN_ERROR',
    })
    await logError(db, {
      code: 'UNKNOWN_ERROR',
      severity: 'error',
      internalMessage: `invalid job payload: ${parsed.error.message}`,
    })
    return { status: 'invalid' }
  }

  const payload = parsed.data
  const maxAttempts = claimed.max_attempts

  await safeSlackCall(() =>
    addReactionFn({ channel: payload.channelId, timestamp: payload.messageTs, name: THINKING_REACTION }),
  )

  try {
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let executed = false
      try {
        await execute(db, payload)
        executed = true
      } catch (err) {
        lastError = err
        await updateJobStatus(db, jobId, { attempt_count: attempt })
        if (attempt < maxAttempts) {
          await sleep(JOB_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
          continue
        }
      }

      // execute 成功時のステータス更新は execute の try/catch 外で行う。
      // ここで失敗しても execute を再実行しない（二重返信の防止）。
      if (executed) {
        await updateJobStatus(db, jobId, {
          status: 'completed',
          finished_at: clock(),
          attempt_count: attempt,
        })
        return { status: 'completed', attempts: attempt }
      }
    }

    // max_attempts 到達（AC-04-03）
    const code = lastError instanceof AppError ? lastError.code : 'UNKNOWN_ERROR'
    await updateJobStatus(db, jobId, {
      status: 'failed',
      finished_at: clock(),
      error_code: code,
      attempt_count: maxAttempts,
    })
    await logError(db, {
      code,
      severity: 'error',
      internalMessage: lastError instanceof Error ? lastError.message : String(lastError),
      personId: payload.personId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      retryable: false,
      rawError: lastError,
    })

    // FR-05 エラーケース: 非サイレントなエラーはユーザー向け文言を Slack に返す（内部詳細は出さない）
    if (!isSilentError(code)) {
      await safeSlackCall(() =>
        postMessage({
          channel: payload.channelId,
          text: getUserFacingMessage(code),
          threadTs: payload.threadTs,
        }),
      )
    }
    return { status: 'failed', attempts: maxAttempts }
  } finally {
    await safeSlackCall(() =>
      removeReactionFn({
        channel: payload.channelId,
        timestamp: payload.messageTs,
        name: THINKING_REACTION,
      }),
    )
  }
}
