/** @file
 * 検証: Supabase クエリエラーの文脈付き変換
 * @verifies -
 */
import { describe, it, expect } from 'vitest'
import { queryError } from './queryError'

describe('queryError', () => {
  it('context と code/details/hint/raw を message に含める', () => {
    const e = queryError('getErrorLogs', {
      message: 'relation does not exist',
      code: '42P01',
      details: 'd',
      hint: 'h',
    })
    expect(e.message).toBe(
      'Supabase query failed: getErrorLogs | message=relation does not exist | code=42P01 | details=d | hint=h | raw={"message":"relation does not exist","code":"42P01","details":"d","hint":"h"}',
    )
    expect(e.cause).toEqual({ message: 'relation does not exist', code: '42P01', details: 'd', hint: 'h' })
  })

  it('全フィールドが空でも context・HTTP ステータス・raw は必ず出る（HEAD エラーの再発防止）', () => {
    const e = queryError('getUsageSummary(today)', { message: '' }, { status: 404, statusText: 'Not Found' })
    expect(e.message).toBe(
      'Supabase query failed: getUsageSummary(today) | http=404 Not Found | raw={"message":""}',
    )
  })
})
