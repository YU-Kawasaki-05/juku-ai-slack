/** @file
 * 機能: ジョブ一覧・キュー集計の取得（管理画面 /admin/jobs 用）
 * 入力: Supabase クライアント（Service Role）, status フィルタ・件数上限
 * 出力: 画面表示用に整形したジョブ行 / status 別の件数と最古の滞留時刻
 * 例外: DB エラーは上位に伝播
 * 依存: jobs, slack_channel_bindings
 * セキュリティ: payload は表示に必要な最小項目（channel/thread/message/person）だけ取り出す
 * @implements FR-04, F-4（ジョブ可視化）
 */
import type { ServerDb, Tables } from '@shared/types/db'
import { queryError } from '@shared/lib/supabase/queryError'

/** jobs.status の取りうる値（migration 013 の CHECK と一致） */
export const JOB_STATUS_VALUES = ['pending', 'processing', 'completed', 'failed'] as const
export type JobStatus = (typeof JOB_STATUS_VALUES)[number]

/** 既定フィルタ: 運用で見たいのは「積み残し」だけなので completed を外す */
export const DEFAULT_JOB_STATUSES: readonly JobStatus[] = ['pending', 'processing', 'failed']

/** 集計カードに出す status（ローンチ計画 KPI「ジョブキュー積み残し 0 件」の可視化） */
export const QUEUE_STAT_STATUSES: readonly JobStatus[] = ['pending', 'processing', 'failed']

/** 一覧の既定件数。PostgREST の暗黙上限（1000）に頼らず必ず明示する */
export const JOB_LIST_LIMIT = 100
export const JOB_LIST_MAX_LIMIT = 500

export interface JobListFilters {
  /** JobStatus または 'all'。未指定は DEFAULT_JOB_STATUSES */
  status?: string
  limit?: number
}

export interface JobListItem {
  id: string
  jobType: string
  status: string
  attemptCount: number
  maxAttempts: number
  errorCode: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
  /** payload 由来（不正 payload なら null） */
  channelId: string | null
  channelName: string | null
  threadTs: string | null
  messageTs: string | null
  personId: string | null
  /** 生成済み回答が退避されているか（A-3。再実行が「配信のみ」で済むかの判断材料） */
  hasResultText: boolean
}

export interface JobQueueStat {
  status: JobStatus
  count: number
  /** 最古の行の基準時刻（processing は started_at、それ以外は created_at）。0 件なら null */
  oldestIso: string | null
}

type JobRow = Pick<
  Tables<'jobs'>,
  | 'id'
  | 'job_type'
  | 'status'
  | 'attempt_count'
  | 'max_attempts'
  | 'error_code'
  | 'created_at'
  | 'updated_at'
  | 'started_at'
  | 'finished_at'
  | 'payload'
  | 'result_text'
>

const LIST_COLUMNS =
  'id, job_type, status, attempt_count, max_attempts, error_code, created_at, updated_at, started_at, finished_at, payload, result_text'

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** payload から表示に使う識別子だけを取り出す（Zod で落とすと不正 payload の行が一覧から消えるため緩く読む） */
export function extractJobTarget(payload: unknown): {
  channelId: string | null
  threadTs: string | null
  messageTs: string | null
  personId: string | null
} {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  return {
    channelId: str(p.channelId),
    threadTs: str(p.threadTs),
    messageTs: str(p.messageTs),
    personId: str(p.personId),
  }
}

/** slack_channel_id → 表示名（jobs は名前を持たないため bindings から解決する） */
async function resolveChannelNames(db: ServerDb, channelIds: string[]): Promise<Map<string, string>> {
  if (channelIds.length === 0) return new Map()
  const { data, error } = await db
    .from('slack_channel_bindings')
    .select('slack_channel_id, slack_channel_name')
    .in('slack_channel_id', channelIds)
  if (error) throw queryError('listJobs.resolveChannelNames', error)
  const map = new Map<string, string>()
  for (const b of data ?? []) {
    if (b.slack_channel_name) map.set(b.slack_channel_id, b.slack_channel_name)
  }
  return map
}

/** 一覧に出す status を決める。不正値は既定（積み残しのみ）に倒す */
export function resolveStatusFilter(status: string | undefined): readonly JobStatus[] {
  if (status === 'all') return JOB_STATUS_VALUES
  if (status && (JOB_STATUS_VALUES as readonly string[]).includes(status)) {
    return [status as JobStatus]
  }
  return DEFAULT_JOB_STATUSES
}

export async function listJobs(
  db: ServerDb,
  filters: JobListFilters = {},
): Promise<JobListItem[]> {
  const statuses = resolveStatusFilter(filters.status)
  const limit = Math.min(Math.max(filters.limit ?? JOB_LIST_LIMIT, 1), JOB_LIST_MAX_LIMIT)

  const { data, error } = await db
    .from('jobs')
    .select(LIST_COLUMNS)
    .in('status', [...statuses])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw queryError('listJobs', error)

  const rows = (data ?? []) as unknown as JobRow[]
  const targets = rows.map((r) => extractJobTarget(r.payload))
  const names = await resolveChannelNames(db, [
    ...new Set(targets.map((t) => t.channelId).filter((v): v is string => Boolean(v))),
  ])

  return rows.map((row, i) => ({
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ...targets[i],
    channelName: targets[i].channelId ? (names.get(targets[i].channelId) ?? null) : null,
    hasResultText: Boolean(row.result_text),
  }))
}

/**
 * status 別の件数と最古の滞留時刻。
 * count は limit の影響を受けない（PostgREST の count はフィルタ全体に対する件数）ため、
 * 「最古 1 行 + 総件数」を status ごとに 1 クエリで取れる。
 */
export async function getJobQueueStats(db: ServerDb): Promise<JobQueueStat[]> {
  const stats: JobQueueStat[] = []
  for (const status of QUEUE_STAT_STATUSES) {
    // 「いつから滞留しているか」の基準列。processing だけは実行開始時刻で測る
    const column = status === 'processing' ? 'started_at' : 'created_at'
    const { data, count, error } = await db
      .from('jobs')
      .select('created_at, started_at', { count: 'exact' })
      .eq('status', status)
      .order(column, { ascending: true })
      .limit(1)
    if (error) throw queryError(`getJobQueueStats(${status})`, error)
    const oldest = (data ?? [])[0]
    stats.push({
      status,
      count: count ?? 0,
      // processing でも started_at が無い異常行に備えて created_at にフォールバック
      oldestIso: oldest
        ? ((column === 'started_at' ? oldest.started_at : oldest.created_at) ??
          oldest.created_at ??
          null)
        : null,
    })
  }
  return stats
}
