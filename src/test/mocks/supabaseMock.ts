/** @file
 * 検証補助: Supabase クエリビルダーのチェーンを模したモック
 * @verifies -
 */
import { vi } from 'vitest'

export interface MockResult {
  data?: unknown
  error?: unknown
  /** .select('*', { count: 'exact', head: true }) の件数 */
  count?: number
}

export interface MockDbHandlers {
  /** .maybeSingle() の戻り。配列を渡すと呼び出し順に消費される */
  maybeSingle?: MockResult | MockResult[]
  /** .single() の戻り。配列を渡すと呼び出し順に消費される */
  single?: MockResult | MockResult[]
  /** 終端メソッドなしで await した場合（insert/update/delete）の戻り */
  thenable?: MockResult
  /** db.rpc(name, args) の戻り。関数名をキーにする（未登録は空結果） */
  rpc?: Record<string, MockResult>
}

export interface MockDbCalls {
  from: string[]
  insert: unknown[]
  update: unknown[]
  upsert: unknown[]
  upsertOptions: unknown[]
  /** [column, value] の配列 */
  eq: Array<[string, unknown]>
  /** [column, value] の配列（.neq()） */
  neq: Array<[string, unknown]>
  /** [column, value] の配列（.lt()） */
  lt: Array<[string, unknown]>
  /** [column, ascending] の配列（.order()） */
  order: Array<[string, boolean | undefined]>
  /** [from, to] の配列（.range()） */
  range: Array<[number, number]>
  /** [関数名, 引数] の配列（db.rpc()） */
  rpc: Array<[string, unknown]>
  delete: number
}

function dequeue(value: MockResult | MockResult[] | undefined, queue: MockResult[]): MockResult {
  if (Array.isArray(value)) return queue.shift() ?? { data: null, error: null }
  return value ?? { data: null, error: null }
}

/**
 * from().select().eq().maybeSingle() 等のチェーンを扱う簡易モック。
 * 各終端の戻り値を handlers で指定でき、eq/upsert オプション/delete も記録する。
 * single/maybeSingle は配列を渡すと呼び出し順に別々の値を返す（insert→衝突→update の検証用）。
 */
export function createMockDb(handlers: MockDbHandlers = {}) {
  const calls: MockDbCalls = {
    from: [],
    insert: [],
    update: [],
    upsert: [],
    upsertOptions: [],
    eq: [],
    neq: [],
    lt: [],
    order: [],
    range: [],
    rpc: [],
    delete: 0,
  }
  const singleQueue = Array.isArray(handlers.single) ? [...handlers.single] : []
  const maybeSingleQueue = Array.isArray(handlers.maybeSingle) ? [...handlers.maybeSingle] : []

  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn((column: string, options?: { ascending?: boolean }) => {
      calls.order.push([column, options?.ascending])
      return builder
    }),
    limit: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      calls.range.push([from, to])
      return builder
    }),
    in: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      calls.eq.push([column, value])
      return builder
    }),
    neq: vi.fn((column: string, value: unknown) => {
      calls.neq.push([column, value])
      return builder
    }),
    lt: vi.fn((column: string, value: unknown) => {
      calls.lt.push([column, value])
      return builder
    }),
    delete: vi.fn(() => {
      calls.delete += 1
      return builder
    }),
    maybeSingle: vi.fn(() => Promise.resolve(dequeue(handlers.maybeSingle, maybeSingleQueue))),
    single: vi.fn(() => Promise.resolve(dequeue(handlers.single, singleQueue))),
    insert: vi.fn((v: unknown) => {
      calls.insert.push(v)
      return builder
    }),
    update: vi.fn((v: unknown) => {
      calls.update.push(v)
      return builder
    }),
    upsert: vi.fn((v: unknown, options?: unknown) => {
      calls.upsert.push(v)
      calls.upsertOptions.push(options)
      return builder
    }),
    then: (onFulfilled: (value: MockResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(handlers.thenable ?? { error: null }).then(onFulfilled, onRejected),
  }

  const db = {
    from: vi.fn((table: string) => {
      calls.from.push(table)
      return builder
    }),
    rpc: vi.fn((fn: string, args?: unknown) => {
      calls.rpc.push([fn, args])
      return Promise.resolve(handlers.rpc?.[fn] ?? { data: null, error: null })
    }),
    __calls: calls,
    __builder: builder,
  }

  return db as unknown as import('@shared/types/db').ServerDb & {
    __calls: MockDbCalls
    __builder: typeof builder
  }
}
