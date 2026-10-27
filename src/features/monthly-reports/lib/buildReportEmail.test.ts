/** @file
 * 検証: 月次レポートのメール本文（質問数の一覧・質問なし・手書き・未作成の注記・管理画面リンク）
 * @verifies FR-08
 */
import { describe, it, expect } from 'vitest'
import { buildAdminReportsUrl, buildReportEmail, type StudentMailRow } from './buildReportEmail'

const rows: StudentMailRow[] = [
  { displayName: 'ベータ', questions: 0, status: 'no_questions' },
  { displayName: 'アルファ', questions: 12, status: 'attached' },
  { displayName: 'ガンマ', questions: 5, status: 'manual' },
  { displayName: 'デルタ', questions: 3, status: 'missing' },
]

describe('buildReportEmail', () => {
  const { subject, text } = buildReportEmail({
    month: '2026-09',
    rows,
    attachedCount: 1,
    adminHost: 'juku.example.com',
  })

  it('件名に対象月と添付数が入る', () => {
    expect(subject).toBe('【marubo】2026年9月分 月次レポート（AI 下書き 1名分）')
  })

  it('生徒ごとの質問数を一覧にし、0 件は「質問なし」と書く', () => {
    expect(text).toContain('・アルファ: 12件（レポート添付）')
    expect(text).toContain('・ベータ: 質問なし')
    expect(text).toContain('・ガンマ: 5件（手書きのレポートがあるため添付なし）')
    expect(text).toContain('・デルタ: 3件（レポートを作成できていません）')
  })

  it('作成できていない生徒がいれば注記する', () => {
    expect(text).toContain('1名分はレポートを作成できていません')
  })

  it('管理画面のレポート一覧（対象月で絞り込み）への案内を入れる', () => {
    expect(text).toContain('https://juku.example.com/admin/reports?month=2026-09')
    expect(text).toContain('承認するまでは Bot の回答には使われません')
  })

  it('全員そろっていれば未作成の注記は出さない', () => {
    const ok = buildReportEmail({ month: '2026-09', rows: rows.slice(0, 3), attachedCount: 1 })
    expect(ok.text).not.toContain('作成できていません')
  })

  it('ドメインが無ければリンクは出さず、画面での探し方を書く', () => {
    const noHost = buildReportEmail({ month: '2026-09', rows, attachedCount: 1, adminHost: null })
    expect(noHost.text).not.toContain('https://')
    expect(noHost.text).toContain('対象月で絞り込んでください')
  })

  it('対象の生徒がいない月でも本文が成り立つ', () => {
    const empty = buildReportEmail({ month: '2026-09', rows: [], attachedCount: 0 })
    expect(empty.text).toContain('対象の生徒がいません')
  })
})

describe('buildAdminReportsUrl', () => {
  it('スキーム・末尾スラッシュを正規化する', () => {
    expect(buildAdminReportsUrl('https://a.example.com/', '2026-09')).toBe(
      'https://a.example.com/admin/reports?month=2026-09',
    )
  })
  it('空は null', () => {
    expect(buildAdminReportsUrl('  ', '2026-09')).toBeNull()
    expect(buildAdminReportsUrl(undefined, '2026-09')).toBeNull()
  })
})
