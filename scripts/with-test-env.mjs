#!/usr/bin/env node
/** @file
 * 機能: .env.test を読み込んでから任意のコマンドを実行する（E2E の build / playwright 共通の入口）
 * 入力: argv[2..] = 実行するコマンドと引数（例: `node scripts/with-test-env.mjs next build`）
 * 出力: 子プロセスの終了コードをそのまま返す
 * 依存: scripts/test-env.mjs
 * 備考: PATH に node_modules/.bin を足すので、pnpm script 経由でも直接 node で叩いても動く
 */
import { spawn } from 'node:child_process'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTestEnv } from './test-env.mjs'

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: node scripts/with-test-env.mjs <command> [args...]')
  process.exit(2)
}

loadTestEnv()

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const binDir = join(repoRoot, 'node_modules', '.bin')
const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` }

const child = spawn(command, args, { stdio: 'inherit', env, cwd: repoRoot })
child.on('error', (err) => {
  console.error(`failed to run "${command}": ${err.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
