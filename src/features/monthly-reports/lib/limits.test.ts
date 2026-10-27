/** @file
 * 検証: 実行時間の上限（LLM・Embedding・Resend のタイムアウトを足しても関数の上限 300 秒に収まる）と
 *   migration 033 の冪等性
 * @verifies FR-08
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MONTHLY_REPORT_TIME_BUDGET_MS, RESEND_TIMEOUT_MS } from '@shared/lib/constants'

const LLM_TIMEOUT_MS = 60_000 // openaiCompatibleClient の既定
const EMBEDDING_TIMEOUT_MS = 60_000 // embeddingClient の timeout

describe('時間の上限', () => {
  it('着手を止める時間 + 最後の 1 人の LLM・Embedding + メール送信のタイムアウトが 300 秒を超えない', () => {
    expect(MONTHLY_REPORT_TIME_BUDGET_MS).toBe(150_000)
    expect(
      MONTHLY_REPORT_TIME_BUDGET_MS + LLM_TIMEOUT_MS + EMBEDDING_TIMEOUT_MS + RESEND_TIMEOUT_MS,
    ).toBeLessThanOrEqual(300_000)
  })
})

describe('migration 033', () => {
  const sql = readFileSync(
    join(__dirname, '../../../../supabase/migrations/033_create_monthly_report_runs.sql'),
    'utf-8',
  )

  it('CREATE POLICY の前に DROP POLICY IF EXISTS があり、再実行しても失敗しない', () => {
    const drop = sql.indexOf('DROP POLICY IF EXISTS "staff_admin_select" ON monthly_report_runs')
    const create = sql.indexOf('CREATE POLICY "staff_admin_select" ON monthly_report_runs')
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
  })
})
