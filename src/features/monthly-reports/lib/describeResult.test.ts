/** @file
 * 検証: 実行結果の日本語メッセージ（管理画面のダイアログに出す）
 * @verifies FR-08
 */
import { describe, it, expect } from 'vitest'
import { describeResult } from './describeResult'
import type { MonthlyReportsResult } from './runMonthlyReports'

const base: MonthlyReportsResult = {
  month: '2026-09',
  students: 10,
  noQuestions: 2,
  generated: 6,
  alreadyGenerated: 1,
  manualExisting: 1,
  failed: 0,
  remaining: 0,
  stoppedBy: null,
  generationBlocked: null,
  embeddingFailed: 0,
  mail: 'sent',
}

describe('describeResult', () => {
  it('件数とメール結果を 1 つにまとめる', () => {
    const text = describeResult(base)
    expect(text).toContain('2026年9月分')
    expect(text).toContain('作成 6件')
    expect(text).toContain('質問なし 2名')
    expect(text).toContain('メール: 送信しました')
  })

  it('送信済みの月は再送しないと伝え、件数は出さない', () => {
    const text = describeResult({ ...base, mail: 'already_sent', generated: 0 })
    expect(text).toContain('送信済み')
    expect(text).not.toContain('作成 ')
  })

  it('残りがあれば、もう一度押すよう案内する（止めた理由つき）', () => {
    const limit = describeResult({ ...base, remaining: 3, stoppedBy: 'limit', mail: 'deferred' })
    expect(limit).toContain('あと 3名分が未作成')
    expect(limit).toContain('もう一度押す')
    expect(describeResult({ ...base, remaining: 3, stoppedBy: 'time', mail: 'deferred' })).toContain('時間')
  })

  it('メール設定なし・失敗・LLM を呼べない理由・Embedding 失敗を伝える', () => {
    expect(describeResult({ ...base, mail: 'not_configured' })).toContain('設定なし')
    expect(describeResult({ ...base, mail: 'failed', mailError: 'Resend: HTTP 422' })).toContain('HTTP 422')
    expect(describeResult({ ...base, generationBlocked: 'ai_paused', remaining: 1, mail: 'deferred' })).toContain('緊急停止')
    expect(describeResult({ ...base, generationBlocked: 'llm_not_configured', remaining: 1, mail: 'deferred' })).toContain('LLM が未設定')
    expect(describeResult({ ...base, embeddingFailed: 2 })).toContain('2件で AI 参照データ')
  })
})
