/** @file
 * 検証: P(mastery) 取得（未取得はデフォルト）
 * @verifies FR-23, BR-05-05
 */
import { describe, it, expect } from 'vitest'
import { getMastery } from './getMastery'
import { P_MASTERY_DEFAULT } from '@shared/lib/constants'
import { createMockDb } from '@/test/mocks/supabaseMock'

describe('getMastery', () => {
  it('topic 未指定はデフォルトを返す（DB を引かない）', async () => {
    const db = createMockDb({})
    expect(await getMastery(db, 'p1', null)).toBe(P_MASTERY_DEFAULT)
    expect(db.__calls.from.length).toBe(0)
  })

  it('該当トピックがあれば p_mastery を返す', async () => {
    const db = createMockDb({ maybeSingle: { data: { p_mastery: 0.65 }, error: null } })
    expect(await getMastery(db, 'p1', '二次方程式')).toBe(0.65)
    expect(db.__calls.eq).toContainEqual(['person_id', 'p1'])
    expect(db.__calls.eq).toContainEqual(['topic', '二次方程式'])
  })

  it('該当トピックが無ければデフォルト', async () => {
    const db = createMockDb({ maybeSingle: { data: null, error: null } })
    expect(await getMastery(db, 'p1', '未知トピック')).toBe(P_MASTERY_DEFAULT)
  })
})
