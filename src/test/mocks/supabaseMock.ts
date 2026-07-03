/** @file
 * 検証補助: Supabase クエリビルダーのチェーンを模したモック
 * @verifies -
 */
import { vi } from 'vitest'

export interface MockResult {
  data?: unknown
  error?: unknown
}

export interface MockDbHandlers {
  /** .maybeSingle() の戻り */
  maybeSingle?: MockResult
  /** .single() の戻り */
  single?: MockResult
  /** 終端メソッドなしで await した場合（insert/update）の戻り */
  thenable?: MockResult
}

export interface MockDbCalls {
  from: string[]
  insert: unknown[]
  update: unknown[]
  upsert: unknown[]
}

/**
 * from().select().eq().maybeSingle() 等のチェーンを一様に扱う簡易モック。
 * 各終端の戻り値を handlers で指定できる。呼び出し引数は __calls に記録される。
 */
export function createMockDb(handlers: MockDbHandlers = {}) {
  const calls: MockDbCalls = { from: [], insert: [], update: [], upsert: [] }

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(handlers.maybeSingle ?? { data: null, error: null })),
    single: vi.fn(() => Promise.resolve(handlers.single ?? { data: null, error: null })),
    insert: vi.fn((v: unknown) => {
      calls.insert.push(v)
      return builder
    }),
    update: vi.fn((v: unknown) => {
      calls.update.push(v)
      return builder
    }),
    upsert: vi.fn((v: unknown) => {
      calls.upsert.push(v)
      return builder
    }),
    // 終端メソッドなしで await されたときの解決値
    then: (onFulfilled: (value: MockResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(handlers.thenable ?? { error: null }).then(onFulfilled, onRejected),
  }

  const db = {
    from: vi.fn((table: string) => {
      calls.from.push(table)
      return builder
    }),
    __calls: calls,
    __builder: builder,
  }

  // ServerDb 型として渡すための緩いキャスト（テスト専用）
  return db as unknown as import('@shared/types/db').ServerDb & {
    __calls: MockDbCalls
    __builder: typeof builder
  }
}
