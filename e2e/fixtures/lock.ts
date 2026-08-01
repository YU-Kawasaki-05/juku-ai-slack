/** @file
 * 機能: spec ファイルをまたいだ共有/排他ロック（Playwright は worker が別プロセスなので変数では効かない）
 * 用途: kill_switches のような**グローバル状態**を触る spec 同士の同時実行を防ぐ
 * 実装: ディレクトリ作成の原子性を使う（mkdir は既存なら必ず失敗する）
 *
 * 排他（acquireLock）  : 状態を書き換える側（kill_switch を停止するテスト）
 * 共有（acquireSharedLock）: 状態が既定値であることに依存する側（LLM 応答を期待する Slack フルフロー）
 *   → 読み手同士は並列のまま。書き手は読み手が居なくなるまで待つ
 */
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LOCK_ROOT = join(tmpdir(), 'marujuku-e2e-locks')

/** グローバル状態を触るリソース名 */
export const KILL_SWITCH_LOCK = 'kill-switch'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function readersDirOf(name: string): string {
  return join(LOCK_ROOT, `${name}.readers`)
}

/** 強制終了で取り残された読み手エントリを回収する */
function activeReaders(name: string, staleMs: number): string[] {
  const dir = readersDirOf(name)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const alive: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry)
    try {
      if (Date.now() - statSync(path).mtimeMs > staleMs) {
        rmSync(path, { recursive: true, force: true })
      } else {
        alive.push(entry)
      }
    } catch {
      // 競合して消えた。生存扱いしない
    }
  }
  return alive
}

/**
 * ロックを取得する。取得できるまで待ち、取れたら解放関数を返す。
 * ワーカーが強制終了してロックが残った場合に備え、`staleMs` 経過したものは回収する。
 */
export async function acquireLock(
  name: string,
  opts: { timeoutMs?: number; staleMs?: number } = {},
): Promise<() => void> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const staleMs = opts.staleMs ?? 180_000
  const dir = join(LOCK_ROOT, name)
  const deadline = Date.now() + timeoutMs

  mkdirSync(LOCK_ROOT, { recursive: true })
  for (;;) {
    try {
      mkdirSync(dir)
      break
    } catch {
      try {
        if (Date.now() - statSync(dir).mtimeMs > staleMs) {
          rmSync(dir, { recursive: true, force: true })
          continue
        }
      } catch {
        // ちょうど解放された。次のループで取得を試みる
      }
      if (Date.now() > deadline) {
        throw new Error(`E2E: ロック "${name}" を ${timeoutMs}ms 以内に取得できませんでした`)
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  // 排他を取れても、まだ読み手が残っていれば居なくなるまで待つ
  while (activeReaders(name, staleMs).length > 0) {
    if (Date.now() > deadline) {
      rmSync(dir, { recursive: true, force: true })
      throw new Error(`E2E: ロック "${name}" の読み手が ${timeoutMs}ms 以内に居なくなりませんでした`)
    }
    await sleep(100)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 共有ロックを取得する。読み手同士は同時に持てるが、排他ロック（書き手）とは同時に成立しない。
 * 用途: kill_switch が「稼働中」であることを前提にするテスト（LLM が呼ばれることを確認する類）。
 */
export async function acquireSharedLock(
  name: string,
  opts: { timeoutMs?: number; staleMs?: number } = {},
): Promise<() => void> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const staleMs = opts.staleMs ?? 180_000
  const writerDir = join(LOCK_ROOT, name)
  const readersDir = readersDirOf(name)
  const entry = join(readersDir, `${process.pid}-${Math.random().toString(36).slice(2, 8)}`)
  const deadline = Date.now() + timeoutMs

  mkdirSync(readersDir, { recursive: true })

  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`E2E: 共有ロック "${name}" を ${timeoutMs}ms 以内に取得できませんでした`)
    }

    // 書き手が居る間は登録すらしない（登録してしまうと書き手を待たせ続ける）
    if (writerExists(writerDir, staleMs)) {
      await sleep(100)
      continue
    }

    mkdirSync(entry, { recursive: true })

    // 登録の直前に書き手が割り込んだ場合は身を引いてやり直す
    if (writerExists(writerDir, staleMs)) {
      rmSync(entry, { recursive: true, force: true })
      await sleep(100)
      continue
    }
    break
  }

  let released = false
  return () => {
    if (released) return
    released = true
    rmSync(entry, { recursive: true, force: true })
  }
}

function writerExists(writerDir: string, staleMs: number): boolean {
  try {
    if (Date.now() - statSync(writerDir).mtimeMs > staleMs) {
      rmSync(writerDir, { recursive: true, force: true })
      return false
    }
    return true
  } catch {
    return false
  }
}
