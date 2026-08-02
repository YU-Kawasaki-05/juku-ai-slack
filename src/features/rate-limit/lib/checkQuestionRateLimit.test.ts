/** @file
 * 検証: person 単位の質問レート制限（F-2 / 運用設計 3.4: 10回/時）
 * @verifies F-2
 */
import { describe, it, expect, vi } from 'vitest'
import { checkQuestionRateLimit } from './checkQuestionRateLimit'
import { RATE_LIMIT_QUESTIONS_PER_HOUR } from '@shared/lib/constants'
import type { ServerDb } from '@shared/types/db'

interface CountCalls {
  select: Array<[string, unknown]>
  eq: Array<[string, unknown]>
  gte: Array<[string, unknown]>
  not: Array<[string, string, unknown]>
}

/** head:true の COUNT クエリ（select/eq/gte/not → { count }）だけを扱う軽量モック */
function createCountDb(result: { count?: number | null; error?: { message: string } | null }) {
  const calls: CountCalls = { select: [], eq: [], gte: [], not: [] }
  const builder = {
    select: (cols: string, options?: unknown) => {
      calls.select.push([cols, options])
      return builder
    },
    eq: (c: string, v: unknown) => {
      calls.eq.push([c, v])
      return builder
    },
    gte: (c: string, v: unknown) => {
      calls.gte.push([c, v])
      return builder
    },
    not: (c: string, op: string, v: unknown) => {
      calls.not.push([c, op, v])
      return builder
    },
    then: (onF: (r: unknown) => unknown) =>
      Promise.resolve({ count: result.count ?? null, error: result.error ?? null }).then(onF),
  }
  const db = { from: () => builder } as unknown as ServerDb
  return { db, calls }
}

const PERSON = '00000000-0000-0000-0000-000000000001'
const NOW = Date.parse('2026-08-02T12:00:00.000Z')

describe('checkQuestionRateLimit', () => {
  it('上限未満なら limited=false', async () => {
    const { db } = createCountDb({ count: RATE_LIMIT_QUESTIONS_PER_HOUR - 1 })
    expect(await checkQuestionRateLimit(db, PERSON, NOW)).toEqual({
      limited: false,
      count: RATE_LIMIT_QUESTIONS_PER_HOUR - 1,
    })
  })

  it('上限ちょうどで limited=true（10回/時: 11回目を止める）', async () => {
    const { db } = createCountDb({ count: RATE_LIMIT_QUESTIONS_PER_HOUR })
    expect(await checkQuestionRateLimit(db, PERSON, NOW)).toEqual({
      limited: true,
      count: RATE_LIMIT_QUESTIONS_PER_HOUR,
    })
  })

  it('person_id と直近1時間で絞り、行本体は取得しない（head:true）', async () => {
    const { db, calls } = createCountDb({ count: 0 })
    await checkQuestionRateLimit(db, PERSON, NOW)

    expect(calls.eq).toContainEqual(['person_id', PERSON])
    expect(calls.gte).toContainEqual(['created_at', '2026-08-02T11:00:00.000Z'])
    expect(calls.select[0][1]).toEqual({ count: 'exact', head: true })
  })

  it('Evaluator / 要約の付随利用は数えない（1質問で上限を食い潰さない）', async () => {
    const { db, calls } = createCountDb({ count: 0 })
    await checkQuestionRateLimit(db, PERSON, NOW)
    expect(calls.not).toContainEqual(['message_ts', 'like', '%-eval'])
    expect(calls.not).toContainEqual(['message_ts', 'like', '%-summary'])
  })

  it('カウント失敗時は制限をスキップする（可用性優先）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db } = createCountDb({ error: { message: 'boom' } })
    expect(await checkQuestionRateLimit(db, PERSON, NOW)).toEqual({ limited: false, count: null })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('count が取れない（null）場合も制限をスキップする', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db } = createCountDb({ count: null })
    expect(await checkQuestionRateLimit(db, PERSON, NOW)).toEqual({ limited: false, count: null })
    warn.mockRestore()
  })

  it('クエリが throw しても制限をスキップする', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = {
      from: () => {
        throw new Error('connection refused')
      },
    } as unknown as ServerDb
    expect(await checkQuestionRateLimit(db, PERSON, NOW)).toEqual({ limited: false, count: null })
    warn.mockRestore()
  })
})
