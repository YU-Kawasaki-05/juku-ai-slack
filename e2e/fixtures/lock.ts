/** @file
 * 機能: spec ファイルをまたいだ排他ロック（Playwright は worker が別プロセスなので変数では効かない）
 * 用途: kill_switches のような**グローバル状態**を触る spec 同士の同時実行を防ぐ
 * 実装: ディレクトリ作成の原子性を使う（mkdir は既存なら必ず失敗する）
 */
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LOCK_ROOT = join(tmpdir(), 'marujuku-e2e-locks')

/** グローバル状態を触るリソース名 */
export const KILL_SWITCH_LOCK = 'kill-switch'

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

  let released = false
  return () => {
    if (released) return
    released = true
    rmSync(dir, { recursive: true, force: true })
  }
}
