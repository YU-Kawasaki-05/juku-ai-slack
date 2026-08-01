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
import {
  JOB_RETRY_BASE_DELAY_MS,
  JOB_RETRY_RATE_LIMIT_BASE_DELAY_MS,
  JOB_RETRY_RATE_LIMIT_FACTOR,
  THINKING_REACTION,
} from '@shared/lib/constants'
import { AppError } from '@shared/lib/errors/AppError'
import { getUserFacingMessage, isSilentError } from '@shared/lib/errors/userMessages'
import { logError } from '@features/error-logs'
import { isAIEnabled } from '@features/kill-switch'
import { processSlackMessagePayloadSchema, type ProcessSlackMessagePayload } from '../types'
import { executeProcessSlackMessage, type ExecuteContext } from './executeProcessMessage'

export type ProcessJobStatus = 'completed' | 'failed' | 'skipped' | 'invalid'

export interface ProcessJobResult {
  status: ProcessJobStatus
  attempts?: number
}

export interface ProcessJobOptions {
  execute?: (
    db: ServerDb,
    payload: ProcessSlackMessagePayload,
    ctx: ExecuteContext,
  ) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  clock?: () => string
  addReactionFn?: typeof addReaction
  removeReactionFn?: typeof removeReaction
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const defaultClock = (): string => new Date().toISOString()

/**
 * attempt 回目の失敗後に待つミリ秒（A-11）。
 * レート制限は provider 側のウィンドウが数秒〜十数秒あるため、通常のバックオフでは短すぎる。
 */
export function retryDelayMs(err: unknown, attempt: number): number {
  const code = err instanceof AppError ? err.code : undefined
  if (code === 'AI_RATE_LIMITED') {
    return JOB_RETRY_RATE_LIMIT_BASE_DELAY_MS * JOB_RETRY_RATE_LIMIT_FACTOR ** (attempt - 1)
  }
  return JOB_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
}

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

  // F-1 / DEC-15: kill_switch が停止中なら LLM を一切呼ばずに定型文だけ返す。
  // ここ（execute の手前 = 🤔 を付ける前）で判定するのがコスト遮断の要件。
  // 停止は障害・コスト対応の意図的な状態なので failed ではなく completed で閉じ、
  // error_code に理由を残す（再実行しても同じ結果になるためリトライさせない）。
  if (!(await isAIEnabled(db))) {
    await safeSlackCall(() =>
      postMessage({
        channel: payload.channelId,
        text: getUserFacingMessage('AI_PAUSED'),
        threadTs: payload.threadTs,
      }),
    )
    await updateJobStatus(db, jobId, {
      status: 'completed',
      finished_at: clock(),
      error_code: 'AI_PAUSED',
    })
    await logError(db, {
      code: 'AI_PAUSED',
      severity: 'info',
      personId: payload.personId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      internalMessage: 'kill switch ai_responses is disabled; skipped LLM call',
    })
    return { status: 'completed', attempts: 0 }
  }

  const maxAttempts = claimed.max_attempts

  // A-3: 生成済みの回答は attempt をまたいで持ち回す（リトライで LLM を再課金しない）。
  // execute が生成に成功した時点で ctx.resultText と jobs.result_text の両方に書き込む。
  const ctx: ExecuteContext = { jobId, resultText: claimed.result_text ?? null }

  await safeSlackCall(() =>
    addReactionFn({ channel: payload.channelId, timestamp: payload.messageTs, name: THINKING_REACTION }),
  )

  try {
    let lastError: unknown
    let usedAttempts = 0
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      usedAttempts = attempt
      let executed = false
      try {
        await execute(db, payload, ctx)
        executed = true
      } catch (err) {
        lastError = err
        await updateJobStatus(db, jobId, { attempt_count: attempt })
        // A-11: 恒久エラー（設定不備・入力超過・Slack 投稿失敗）はリトライしても直らない。
        // 特に SLACK_POST_FAILED の再試行は二重返信を生むため即座に打ち切る
        const retryable = !(err instanceof AppError) || err.retryable
        if (retryable && attempt < maxAttempts) {
          await sleep(retryDelayMs(err, attempt))
          continue
        }
        break
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

    // max_attempts 到達 or 非リトライアブルで打ち切り（AC-04-03 / A-11）
    const code = lastError instanceof AppError ? lastError.code : 'UNKNOWN_ERROR'
    await updateJobStatus(db, jobId, {
      status: 'failed',
      finished_at: clock(),
      error_code: code,
      attempt_count: usedAttempts,
    })
    await logError(db, {
      code,
      severity: 'error',
      internalMessage: lastError instanceof Error ? lastError.message : String(lastError),
      personId: payload.personId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      retryable: lastError instanceof AppError ? lastError.retryable : true,
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
    return { status: 'failed', attempts: usedAttempts }
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
