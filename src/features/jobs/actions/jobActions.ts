/** @file
 * 機能: ジョブ管理画面の Server Action（スイーパ手動実行 / failed ジョブの再実行）
 * 入力: FormData
 * 出力: ActionResult<{ message: string }>
 * 例外: 認証・DB エラーは ActionResult に変換（画面を落とさない）
 * 依存: requireStaff, createServerClient, runJobMaintenance, retryJob, processJob
 * 副作用: jobs の状態更新・期限切れ行の削除・再実行（Slack 投稿を伴う）
 * セキュリティ: requireStaff 必須（運用担当がスタッフのため staff で実行可）。
 *   再実行は二重返信ガード（retryJob）を通過した場合のみ起動する
 * @implements FR-04, FR-13, F-4, A-1, A-14
 */
'use server'

import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { logError } from '@features/error-logs'
import type { ServerDb } from '@shared/types/db'
import type { ActionResult } from '@shared/types/action'
import { runJobMaintenance } from '../lib/sweepStaleJobs'
import { retryJob } from '../lib/retryJob'
import { processJob } from '../lib/processJob'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface JobActionData {
  message: string
}

/**
 * 再実行の本処理。after() が使える文脈ならレスポンス後に回し、
 * 使えなければその場で待つ（管理操作なので数十秒待てる）。
 */
async function startProcessing(db: ServerDb, jobId: string): Promise<void> {
  const run = async (): Promise<void> => {
    try {
      await processJob(db, jobId)
    } catch (err) {
      // after() のコールバックは誰も await しないため、握りつぶすと無音で消える（A-2 と同じ理由）
      try {
        await logError(db, {
          code: 'UNKNOWN_ERROR',
          severity: 'error',
          internalMessage: `retryJobAction: processJob(${jobId}) failed: ${err instanceof Error ? err.message : String(err)}`,
          rawError: err,
        })
      } catch (logErr) {
        console.error('[retryJobAction] failed to log retry failure', jobId, logErr)
      }
    }
  }

  try {
    after(run)
  } catch {
    await run()
  }
}

/** 引数は取らない（useActionState から渡される prevState / FormData は使わない） */
export async function sweepJobsAction(): Promise<ActionResult<JobActionData>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  try {
    const { swept, cleaned } = await runJobMaintenance(createServerClient())
    revalidatePath('/admin/jobs')
    return {
      ok: true,
      data: {
        message: `滞留ジョブを ${swept.total} 件回収、古い記録を ${cleaned.total} 件掃除しました`,
      },
    }
  } catch (err) {
    console.error('[sweepJobsAction] failed', err)
    return { ok: false, error: 'スイープに失敗しました' }
  }
}

export async function retryJobAction(
  _prev: ActionResult<JobActionData> | undefined,
  formData: FormData,
): Promise<ActionResult<JobActionData>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'ログインが必要です' }
  }

  const jobId = String(formData.get('id') ?? '')
  if (!UUID_RE.test(jobId)) return { ok: false, error: '不正なジョブ ID です' }

  const db = createServerClient()
  let outcome
  try {
    outcome = await retryJob(db, jobId)
  } catch (err) {
    console.error('[retryJobAction] failed', err)
    return { ok: false, error: '再実行の準備に失敗しました' }
  }

  switch (outcome.kind) {
    case 'not_found':
      return { ok: false, error: '対象のジョブが見つかりません' }
    case 'not_retryable':
      return { ok: false, error: `${outcome.status} のジョブは再実行できません（失敗したジョブのみ）` }
    case 'invalid_payload':
      return { ok: false, error: 'ジョブの内容が壊れているため再実行できません' }
    case 'conflict':
      return { ok: false, error: 'ジョブの状態が変わったため中止しました。画面を更新してください' }
    case 'already_delivered':
      revalidatePath('/admin/jobs')
      return {
        ok: true,
        data: {
          message: '既に回答が配信済みのため再実行せず、完了として記録しました（二重返信の防止）',
        },
      }
    case 'requeued':
      await startProcessing(db, jobId)
      revalidatePath('/admin/jobs')
      return {
        ok: true,
        data: { message: '再実行を開始しました（完了後に画面を更新してください）' },
      }
  }
}
