/** @file
 * 検証補助: テーブルを配列で持つインメモリの Supabase クライアント風モック
 * 備考: queuedDb は「呼び出し順に結果を返す」ため、フィルタの中身が結果に効く処理
 *   （月で絞る・生徒で絞る・条件付き UPDATE で送信権を取る等）を検証できない。
 *   こちらは eq / in / is / gte / lt / order / range と insert / update / upsert を実際に評価する。
 *   対応していない演算子（or / not / 外部キー結合の select 等）は意図的に未実装 = 使うとテストが落ちて気づける
 * @verifies -
 */
import { randomUUID } from 'node:crypto'
import type { ServerDb } from '@shared/types/db'

type Row = Record<string, unknown>
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete'

export interface MemoryDbOptions {
  tables?: Record<string, Row[]>
  /** テーブルごとの一意キー（複合可）。insert で重複すると 23505 を返す */
  unique?: Record<string, string[]>
  /** insert 時に UUID の id を自動採番するテーブル */
  autoId?: string[]
}

interface DbError {
  code?: string
  message: string
}

interface Injected {
  table: string
  op: Op
  error: DbError
  remaining: number
  /** 指定すると、insert/update/upsert に渡した値がこの条件に合うクエリだけ失敗させる */
  match?: (values: Row | undefined) => boolean
}

function isIso(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)
}

function compare(a: unknown, b: unknown): number {
  if (isIso(a) && isIso(b)) return Date.parse(a) - Date.parse(b)
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  return (a as string | number) < (b as string | number) ? -1 : 1
}

export function createMemoryDb(options: MemoryDbOptions = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(options.tables ?? {})) {
    tables[name] = rows.map((r) => ({ ...r }))
  }
  const injected: Injected[] = []
  const calls: Array<{ table: string; op: Op }> = []

  const rowsOf = (table: string): Row[] => (tables[table] ??= [])
  const uniqueKey = (table: string, row: Row): string | null => {
    const cols = options.unique?.[table]
    return cols ? JSON.stringify(cols.map((c) => row[c] ?? null)) : null
  }

  function takeInjected(table: string, op: Op, values: Row | undefined): DbError | undefined {
    const hit = injected.find(
      (i) => i.table === table && i.op === op && i.remaining > 0 && (!i.match || i.match(values)),
    )
    if (!hit) return undefined
    hit.remaining--
    return hit.error
  }

  class Query implements PromiseLike<{ data: unknown; error: DbError | null }> {
    private op: Op = 'select'
    private values: Row[] = []
    private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
    private filters: Array<(r: Row) => boolean> = []
    private orders: Array<{ col: string; asc: boolean }> = []
    private from_ = 0
    private to_: number | null = null
    private cols: string | null = null
    private returning = false
    private countOnly = false

    constructor(private table: string) {}

    select(cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.head) this.countOnly = true
      if (this.op === 'select' || this.op === 'update' || this.op === 'insert' || this.op === 'upsert') {
        this.returning = true
        this.cols = cols && cols !== '*' ? cols : null
      }
      return this
    }
    insert(v: Row | Row[]) {
      this.op = 'insert'
      this.values = Array.isArray(v) ? v : [v]
      return this
    }
    upsert(v: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
      this.op = 'upsert'
      this.values = Array.isArray(v) ? v : [v]
      this.upsertOpts = o
      return this
    }
    update(v: Row) {
      this.op = 'update'
      this.values = [v]
      return this
    }
    delete() {
      this.op = 'delete'
      return this
    }
    eq(col: string, val: unknown) {
      this.filters.push((r) => {
        const a = r[col]
        if (isIso(a) && isIso(val)) return Date.parse(a) === Date.parse(val)
        return (a ?? null) === (val ?? null)
      })
      return this
    }
    neq(col: string, val: unknown) {
      this.filters.push((r) => r[col] !== val)
      return this
    }
    in(col: string, vals: unknown[]) {
      this.filters.push((r) => vals.includes(r[col]))
      return this
    }
    is(col: string, val: null | boolean) {
      this.filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val))
      return this
    }
    gte(col: string, val: unknown) {
      this.filters.push((r) => r[col] != null && compare(r[col], val) >= 0)
      return this
    }
    /** not(col, 'like', pattern) のみ対応（% を任意の文字列に展開する） */
    not(col: string, op: string, val: string) {
      if (op !== 'like') throw new Error(`memoryDb: not(${op}) is not supported`)
      const re = new RegExp(`^${val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`)
      this.filters.push((r) => !re.test(String(r[col] ?? '')))
      return this
    }
    lt(col: string, val: unknown) {
      this.filters.push((r) => r[col] != null && compare(r[col], val) < 0)
      return this
    }
    order(col: string, o: { ascending?: boolean } = {}) {
      this.orders.push({ col, asc: o.ascending !== false })
      return this
    }
    range(from: number, to: number) {
      this.from_ = from
      this.to_ = to
      return this
    }
    limit(n: number) {
      this.from_ = 0
      this.to_ = n - 1
      return this
    }

    private project(row: Row): Row {
      if (!this.cols) return { ...row }
      const out: Row = {}
      for (const c of this.cols.split(',').map((s) => s.trim())) out[c] = row[c]
      return out
    }

    private execute(): { data: unknown; error: DbError | null } {
      calls.push({ table: this.table, op: this.op })
      const fail = takeInjected(this.table, this.op, this.values[0])
      if (fail) return { data: null, error: fail }
      const rows = rowsOf(this.table)

      if (this.op === 'insert' || this.op === 'upsert') {
        const inserted: Row[] = []
        for (const v of this.values) {
          const row: Row = { ...v }
          if (options.autoId?.includes(this.table) && row.id === undefined) row.id = randomUUID()
          const key = uniqueKey(this.table, row)
          const dup = key === null ? undefined : rows.find((r) => uniqueKey(this.table, r) === key)
          if (dup) {
            if (this.op === 'upsert') {
              if (!this.upsertOpts.ignoreDuplicates) Object.assign(dup, row)
              continue
            }
            return { data: null, error: { code: '23505', message: 'duplicate key value' } }
          }
          rows.push(row)
          inserted.push(row)
        }
        return { data: this.returning ? inserted.map((r) => this.project(r)) : null, error: null }
      }

      const matched = rows.filter((r) => this.filters.every((f) => f(r)))

      if (this.op === 'update') {
        for (const r of matched) Object.assign(r, this.values[0])
        return { data: this.returning ? matched.map((r) => this.project(r)) : null, error: null }
      }
      if (this.op === 'delete') {
        tables[this.table] = rows.filter((r) => !matched.includes(r))
        return { data: null, error: null }
      }

      if (this.countOnly) return { data: null, error: null, count: matched.length } as never

      const sorted = [...matched]
      for (const { col, asc } of [...this.orders].reverse()) {
        sorted.sort((a, b) => (asc ? 1 : -1) * compare(a[col], b[col]))
      }
      const sliced = this.to_ === null ? sorted : sorted.slice(this.from_, this.to_ + 1)
      return { data: sliced.map((r) => this.project(r)), error: null }
    }

    single() {
      const res = this.execute()
      if (res.error) return Promise.resolve(res)
      const list = (res.data as Row[] | null) ?? []
      if (list.length !== 1) {
        return Promise.resolve({ data: null, error: { code: 'PGRST116', message: `expected 1 row, got ${list.length}` } })
      }
      return Promise.resolve({ data: list[0], error: null })
    }
    maybeSingle() {
      const res = this.execute()
      if (res.error) return Promise.resolve(res)
      const list = (res.data as Row[] | null) ?? []
      return Promise.resolve({ data: list[0] ?? null, error: null })
    }
    then<T1, T2>(
      onFulfilled?: ((v: { data: unknown; error: DbError | null; count?: number }) => T1 | PromiseLike<T1>) | null,
      onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ) {
      return Promise.resolve(this.execute()).then(onFulfilled, onRejected)
    }
  }

  const db = {
    from: (table: string) => new Query(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
    /** テーブルの現在の行（テストの検証用） */
    __rows: (table: string) => rowsOf(table),
    /** 発行したクエリの記録 */
    __calls: calls,
    /** 次の table/op のクエリを、指定のエラーで times 回だけ失敗させる */
    __inject: (
      table: string,
      op: Op,
      error: DbError,
      times = 1,
      match?: (values: Row | undefined) => boolean,
    ) => {
      injected.push({ table, op, error, remaining: times, match })
    },
  }
  return db as unknown as ServerDb & {
    __rows(table: string): Row[]
    __calls: typeof calls
    __inject(
      table: string,
      op: Op,
      error: DbError,
      times?: number,
      match?: (values: Row | undefined) => boolean,
    ): void
  }
}
