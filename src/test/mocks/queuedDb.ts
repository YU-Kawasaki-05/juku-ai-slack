/** @file
 * 検証補助: クエリごとに別々の結果を返す Supabase モック
 * 備考: supabaseMock は終端の戻り値がクエリ単位で切り替えられないため、
 *   「select → update → select」のように複数テーブル・複数結果をまたぐ処理の検証に使う。
 *   結果は呼び出し順のキューで消費し、発行されたクエリ（テーブル・演算子・値）を記録する。
 * @verifies -
 */
import { vi } from 'vitest'
import type { ServerDb } from '@shared/types/db'

export interface QueuedResult {
  data?: unknown
  error?: unknown
  count?: number
}

export interface RecordedFilter {
  method: string
  column: string
  value: unknown
}

export interface RecordedQuery {
  table: string
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  /** insert/update/upsert に渡した値 */
  values?: unknown
  /** delete({ count: 'exact' }) 等のオプション */
  options?: unknown
  filters: RecordedFilter[]
  limit?: number
  /** 指定した列（select の引数） */
  columns?: string
  /** column ごとの最後の値を引くヘルパー */
  filterValue(method: string, column: string): unknown
}

const FILTER_METHODS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'is', 'like', 'ilike'] as const

export function createQueuedDb(results: QueuedResult[] = []) {
  const queue = [...results]
  const queries: RecordedQuery[] = []
  const pop = (): QueuedResult => queue.shift() ?? { data: null, error: null }

  function newQuery(table: string): RecordedQuery {
    const q: RecordedQuery = {
      table,
      op: 'select',
      filters: [],
      filterValue(method, column) {
        const hit = [...q.filters].reverse().find((f) => f.method === method && f.column === column)
        return hit?.value
      },
    }
    queries.push(q)
    return q
  }

  function makeBuilder(q: RecordedQuery) {
    const builder: Record<string, unknown> = {
      select: vi.fn((columns?: string, options?: unknown) => {
        if (columns) q.columns = columns
        if (options !== undefined) q.options = options
        return builder
      }),
      order: vi.fn((column: string, options?: unknown) => {
        q.filters.push({ method: 'order', column, value: options })
        return builder
      }),
      limit: vi.fn((n: number) => {
        q.limit = n
        return builder
      }),
      insert: vi.fn((values: unknown) => {
        q.op = 'insert'
        q.values = values
        return builder
      }),
      update: vi.fn((values: unknown) => {
        q.op = 'update'
        q.values = values
        return builder
      }),
      upsert: vi.fn((values: unknown, options?: unknown) => {
        q.op = 'upsert'
        q.values = values
        q.options = options
        return builder
      }),
      delete: vi.fn((options?: unknown) => {
        q.op = 'delete'
        q.options = options
        return builder
      }),
      single: vi.fn(() => Promise.resolve(pop())),
      maybeSingle: vi.fn(() => Promise.resolve(pop())),
      then: (onFulfilled: (value: QueuedResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(pop()).then(onFulfilled, onRejected),
    }
    for (const method of FILTER_METHODS) {
      builder[method] = vi.fn((column: string, value: unknown) => {
        q.filters.push({ method, column, value })
        return builder
      })
    }
    return builder
  }

  const db = {
    from: vi.fn((table: string) => makeBuilder(newQuery(table))),
    rpc: vi.fn(() => Promise.resolve(pop())),
    __queries: queries,
    /** 指定テーブルに発行されたクエリだけを抜き出す */
    __for(table: string) {
      return queries.filter((q) => q.table === table)
    },
    /** 残りの結果キュー（消費漏れの検出用） */
    __remaining: () => queue.length,
  }

  return db as unknown as ServerDb & {
    __queries: RecordedQuery[]
    __for(table: string): RecordedQuery[]
    __remaining(): number
  }
}
