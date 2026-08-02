/** @file
 * 機能: E2E 用の環境変数を .env.test（無ければ .env.test.example）から読み込む
 * 入力: リポジトリ直下の .env.test / .env.test.example
 * 出力: loadTestEnv() が読み込んだ key/value を返し、process.env にも反映する
 * 依存: node:fs のみ（dotenv を追加せずに済ませる。書式は KEY=VALUE の最小サブセット）
 * 備考: 既に process.env にある値は上書きしない（CI の secrets / シェルの一時上書きを優先）
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** KEY=VALUE 形式をパースする。`#` 始まりの行と空行は無視。値の前後のクォートは剥がす */
function parse(text) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * E2E 用 env を読み込み process.env に反映する。
 * 戻り値は「このファイル由来の値」だけを含むので、webServer に渡す env を組み立てるのに使える。
 * @returns {Record<string, string>}
 */
export function loadTestEnv() {
  const file = ['.env.test', '.env.test.example']
    .map((name) => join(repoRoot, name))
    .find((path) => existsSync(path))
  if (!file) return {}

  const values = parse(readFileSync(file, 'utf8'))
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
  return values
}
