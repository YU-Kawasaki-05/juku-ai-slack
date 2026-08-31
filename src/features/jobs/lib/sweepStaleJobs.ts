/** @file
 * 機能: 滞留ジョブの回収（A-1 後半）と receipts/jobs の保持期間掃除（A-14）
 * 入力: Supabase クライアント（Service Role）, 基準時刻
 * 出力: 回収件数 / 削除件数
 * 例外: DB エラーは上位に伝播（呼び出し側でベストエフォート化する）
 * 依存: jobs, slack_event_receipts, ai_error_logs（logError）, Slack reactions.remove
 * 副作用: jobs の failed 化 + JOB_TIMEOUT のエラーログ記録、🤔 リアクションの除去、期限切れ行の DELETE
 * セキュリティ: Service Role 前提のサーバー専用処理。payload は Zod 検証してからログに載せる
 * @implements FR-04（AC-04-03 の後始末）, A-1, A-14, AC-01-06
 *
 * 実行タイミング: DEC-13 により Vercel Cron / pg_cron は使わない。
 *   管理画面 /admin/jobs の表示時にベストエフォートで自動実行し、加えて手動実行ボタンを置く。
 *   スイープは「無応答のまま残ったジョブを可視化して運用者に気づかせる」のが目的で、
 *   秒単位の即時性は不要なため、スタッフが管理画面を開く頻度（日次〜数時間おき）で十分回る。
 *   将来 Cron を使える契約になったら、この関数をそのまま定期実行に載せ替えればよい。
 */
import type { ServerDb } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'
import { logError } from '@features/error-logs'
import { removeReaction } from '@shared/lib/slack/client'
import {
  JOB_PENDING_TIMEOUT_MIN,
  JOB_PROCESSING_TIMEOUT_MIN,
  JOB_RETENTION_DAYS,
  RECEIPT_RETENTION_DAYS,
  THINKING_REACTION,
} from '@shared/lib/constants'
import { processSlackMessagePayloadSchema } from '../types'

/** 1 回のスイープで回収する上限（異常時に管理画面の表示を長時間ブロックしないための安全弁） */
export const SWEEP_BATCH_LIMIT = 100

/** 掃除対象になるジョブの終了状態（運用設計 1.1: completed/failed。将来の skipped も含める） */
export const TERMINAL_JOB_STATUSES = ['completed', 'skipped', 'failed'] as const

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

export interface SweepResult {
  /** processing のまま閾値を超えたジョブ（after() が途中で kill された） */
  stuckProcessing: number
  /** pending のまま閾値を超えたジョブ（after() 自体が走らなかった孤児） */
  orphanPending: number
  total: number
}

export interface CleanupResult {
  /** 削除した slack_event_receipts の行数 */
  receipts: number
  /** 削除した jobs の行数 */
  jobs: number
  total: number
}

export interface JobMaintenanceResult {
  swept: SweepResult
  cleaned: CleanupResult
}

interface StaleJobRow {
  id: string
  payload: unknown
  started_at: string | null
  created_at: string
  attempt_count: number
}

interface JobTarget {
  personId: string | null
  channelId: string | null
  threadTs: string | null
  messageTs: string | null
}

/** payload から通知先の手がかりを取り出す（不正 payload でも回収自体は止めない） */
function jobTarget(payload: unknown): JobTarget {
  const parsed = processSlackMessagePayloadSchema.safeParse(payload)
  if (!parsed.success) return { personId: null, channelId: null, threadTs: null, messageTs: null }
  return {
    personId: parsed.data.personId,
    channelId: parsed.data.channelId,
    threadTs: parsed.data.threadTs,
    messageTs: parsed.data.messageTs,
  }
}

/**
 * 🤔 を外す（AC-01-06）。processJob の finally は after() が実行時間上限で kill されると走らないため、
 * 回収時にここで落とさないとリアクションが永久に残り、生徒には「まだ考え中」に見え続ける。
 * Slack 障害やトークン未設定でスイープ全体を止めないよう、失敗はサイレントに握る（BR-01-06）。
 */
async function clearThinkingReaction(target: JobTarget): Promise<void> {
  if (!target.channelId || !target.messageTs) return
  try {
    await removeReaction({
      channel: target.channelId,
      timestamp: target.messageTs,
      name: THINKING_REACTION,
    })
  } catch {
    // 回収自体は成立させる（🤔 が残っても jobs は failed として可視化される）
  }
}

/**
 * 滞留ジョブ 1 件を failed 化する。
 * 直前に本来の処理が完了している可能性があるため、元 status を条件に付けた CAS で更新し、
 * 0 行更新なら「回収しなかった」として扱う（完了済みジョブを failed に落とさない）。
 */
async function failStaleJob(
  db: ServerDb,
  row: StaleJobRow,
  fromStatus: 'processing' | 'pending',
  nowIso: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('jobs')
    .update({ status: 'failed', error_code: 'JOB_TIMEOUT', finished_at: nowIso })
    .eq('id', row.id)
    .eq('status', fromStatus)
    .select('id')
  if (error) throw queryError('sweepStaleJobs.failStaleJob', error)
  if (!data || data.length === 0) return false

  const since = fromStatus === 'processing' ? row.started_at : row.created_at
  const limitMin =
    fromStatus === 'processing' ? JOB_PROCESSING_TIMEOUT_MIN : JOB_PENDING_TIMEOUT_MIN

  const target = jobTarget(row.payload)

  await logError(db, {
    code: 'JOB_TIMEOUT',
    severity: 'error',
    internalMessage:
      `job ${row.id} が ${fromStatus} のまま ${limitMin} 分を超過したため failed 化しました` +
      `（since=${since ?? 'unknown'}, attempt=${row.attempt_count}）`,
    // 生徒への再通知はスイーパからは行わない。kill される直前に投稿済みの可能性があり、
    // ここで詫び文言を送ると二重返信になるため、再実行は管理画面（配信済み判定つき）に委ねる
    retryable: true,
    ...target,
  })

  // pending 側は claim 前＝🤔 を付ける前に止まっているので除去対象は processing だけ
  if (fromStatus === 'processing') await clearThinkingReaction(target)
  return true
}

async function selectStale(
  db: ServerDb,
  status: 'processing' | 'pending',
  column: 'started_at' | 'created_at',
  cutoffIso: string,
): Promise<StaleJobRow[]> {
  const { data, error } = await db
    .from('jobs')
    .select('id, payload, started_at, created_at, attempt_count')
    .eq('status', status)
    .lt(column, cutoffIso)
    .order(column, { ascending: true })
    .limit(SWEEP_BATCH_LIMIT)
  if (error) throw queryError(`sweepStaleJobs.select(${status})`, error)
  return (data ?? []) as StaleJobRow[]
}

/**
 * 閾値を超えた滞留ジョブを failed + JOB_TIMEOUT に回収する（A-1）。
 * (a) processing かつ started_at 超過: after() が実行時間上限で kill されたケース。
 *     started_at は claim 時に必ず入るため、NULL の processing 行は発生しない前提。
 * (b) pending かつ created_at 超過: after() 自体が走らなかった孤児。
 *     scheduled_at による遅延実行は使っていないので、閾値超過の pending は実行機会を失っている。
 */
export async function sweepStaleJobs(db: ServerDb, now: Date = new Date()): Promise<SweepResult> {
  const nowIso = now.toISOString()
  const processingCutoff = new Date(now.getTime() - JOB_PROCESSING_TIMEOUT_MIN * MINUTE_MS).toISOString()
  const pendingCutoff = new Date(now.getTime() - JOB_PENDING_TIMEOUT_MIN * MINUTE_MS).toISOString()

  let stuckProcessing = 0
  for (const row of await selectStale(db, 'processing', 'started_at', processingCutoff)) {
    if (await failStaleJob(db, row, 'processing', nowIso)) stuckProcessing += 1
  }

  let orphanPending = 0
  for (const row of await selectStale(db, 'pending', 'created_at', pendingCutoff)) {
    if (await failStaleJob(db, row, 'pending', nowIso)) orphanPending += 1
  }

  return { stuckProcessing, orphanPending, total: stuckProcessing + orphanPending }
}

/**
 * 保持期間を過ぎた行を削除する（A-14。運用設計 1.1: receipts 30日 / jobs 7日）。
 * receipts は重複排除の材料なので、Slack の再送期間（数時間）を大きく超えた分だけを消す。
 */
export async function cleanupOldRows(db: ServerDb, now: Date = new Date()): Promise<CleanupResult> {
  const receiptCutoff = new Date(now.getTime() - RECEIPT_RETENTION_DAYS * DAY_MS).toISOString()
  const jobCutoff = new Date(now.getTime() - JOB_RETENTION_DAYS * DAY_MS).toISOString()

  const receiptsRes = await db
    .from('slack_event_receipts')
    .delete({ count: 'exact' })
    .lt('received_at', receiptCutoff)
  if (receiptsRes.error) throw queryError('cleanupOldRows.receipts', receiptsRes.error)

  // 実行中・待機中のジョブは日付に関係なく残す（誤って未処理の質問を消さない）
  const jobsRes = await db
    .from('jobs')
    .delete({ count: 'exact' })
    .in('status', [...TERMINAL_JOB_STATUSES])
    .lt('created_at', jobCutoff)
  if (jobsRes.error) throw queryError('cleanupOldRows.jobs', jobsRes.error)

  const receipts = receiptsRes.count ?? 0
  const jobs = jobsRes.count ?? 0
  return { receipts, jobs, total: receipts + jobs }
}

/** 回収 → 掃除の順に実行する（回収直後の failed 行は掃除対象の日付に入らない） */
export async function runJobMaintenance(
  db: ServerDb,
  now: Date = new Date(),
): Promise<JobMaintenanceResult> {
  const swept = await sweepStaleJobs(db, now)
  const cleaned = await cleanupOldRows(db, now)
  return { swept, cleaned }
}
