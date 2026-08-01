/** @file
 * 機能: person 単位の質問レート制限判定（F-2 / 運用設計 3.4: 10回/時）
 * 入力: Supabase クライアント（Service Role）, personId, 現在時刻（テスト用）
 * 出力: { limited, count }
 * 例外: なし（数えられなければ制限をかけずに通す）
 * 依存: ai_usage_logs テーブル
 * 副作用: なし（COUNT のみ。head:true で行本体は取得しない）
 * セキュリティ: personId は channel_id 解決済みの値のみ（BR-05-11）
 * @implements FR-05, F-2
 */
import type { ServerDb } from '@shared/types/db'
import { RATE_LIMIT_QUESTIONS_PER_HOUR, RATE_LIMIT_WINDOW_MS } from '@shared/lib/constants'

export interface RateLimitResult {
  /** 上限に達しているか */
  limited: boolean
  /** ウィンドウ内の質問回数。数えられなかった場合は null */
  count: number | null
}

/**
 * ai_usage_logs には Tutor 応答のほかに Evaluator（`<ts>-eval`）とスレッド要約（`<ts>-summary`）の
 * 行も入る。これらは生徒の質問ではなく 1 質問に付随する内部呼び出しなので、
 * 数に入れると実質 3〜4 回の質問で上限に達してしまう。message_ts のサフィックスで除外する
 * （logUsage が付ける命名規約。専用の usage_type 列は無い）。
 */
const DERIVED_USAGE_SUFFIXES = ['%-eval', '%-summary'] as const

/**
 * 直近 1 時間の質問回数を数え、上限（RATE_LIMIT_QUESTIONS_PER_HOUR）に達しているか返す。
 * 数え損ねた場合は limited=false（可用性優先: 集計の不調で正常な生徒の質問を止めない）。
 */
export async function checkQuestionRateLimit(
  db: ServerDb,
  personId: string,
  nowMs: number = Date.now(),
): Promise<RateLimitResult> {
  const since = new Date(nowMs - RATE_LIMIT_WINDOW_MS).toISOString()

  try {
    let query = db
      .from('ai_usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('person_id', personId)
      .gte('created_at', since)
    for (const pattern of DERIVED_USAGE_SUFFIXES) {
      query = query.not('message_ts', 'like', pattern)
    }
    const { count, error } = await query

    if (error) {
      console.warn('[rateLimit] failed to count recent questions (skipping limit):', error.message)
      return { limited: false, count: null }
    }
    if (typeof count !== 'number') {
      console.warn('[rateLimit] count unavailable (skipping limit)')
      return { limited: false, count: null }
    }
    return { limited: count >= RATE_LIMIT_QUESTIONS_PER_HOUR, count }
  } catch (err) {
    console.warn(
      '[rateLimit] rate limit lookup threw (skipping limit):',
      err instanceof Error ? err.message : String(err),
    )
    return { limited: false, count: null }
  }
}
