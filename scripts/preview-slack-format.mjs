#!/usr/bin/env node
/** @file
 * =============================================================================
 *  juku-ai-slack — Slack 出力整形のプレビュー
 * =============================================================================
 *  何のためにあるか:
 *    formatForSlack() が「LLM の生出力」を「Slack へ送る文字列」へどう変えるかを、
 *    テストを読まずに目で確認するためのもの。生徒に見える文章の品質を、
 *    実装を読める人でなくても判断できるようにする（T-0110 / Q-0048）。
 *
 *  使い方:
 *    node scripts/preview-slack-format.mjs                 # 代表例をまとめて表示
 *    node scripts/preview-slack-format.mjs "## 見出し"      # 文字列を1つ試す
 *    node scripts/preview-slack-format.mjs --file out.txt  # ファイルの中身を試す
 *    cat out.txt | node scripts/preview-slack-format.mjs -  # 標準入力
 *    node scripts/preview-slack-format.mjs --raw "..."     # 整形後の文字列だけを出す（配管用）
 *
 *  表示の3段:
 *    ① LLM の生出力      … 整形前。Slack にそのまま流すと崩れるもの
 *    ② Slack へ送る文字列 … formatForSlack() の戻り値
 *    ③ Slack での見え方   … ② を Slack が描画した結果の近似（太字などを端末の装飾で再現）
 *
 *  ③ は近似です。Slack 本体のレンダラではないので、最終確認は実機の Slack で行ってください。
 * =============================================================================
 */

// .ts を直接 import するので Node の型ストリップに依存する。package.json に "type" が無いため
// 出る MODULE_TYPELESS_PACKAGE_JSON の警告は、この用途では無意味なので黙らせる
// （既定リスナを外してから自前のものを付ける。import は下で動的に行うのでこの順で間に合う）。
process.removeAllListeners('warning')
process.on('warning', (w) => {
  const code = String(w.code ?? '')
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON' || w.name === 'ModuleTypelessPackageJsonWarning') return
  console.warn(w)
})

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `このスクリプトは TypeScript を直接読み込むため Node 22.18 以上が必要です（現在 v${process.versions.node}）。\n` +
      '  対処: nvm use 22 などで新しい Node に切り替えてください。',
  )
  process.exit(1)
}

const { formatForSlack } = await import('../src/shared/lib/slack/formatForSlack.ts')

// ---- 端末の装飾（③ の近似描画に使う） ----

// FORCE_COLOR=1 を付けるとパイプ・リダイレクト先でも装飾を残す（③ をファイルに保存したいとき用）
const TTY = (process.stdout.isTTY || process.env.FORCE_COLOR === '1') && !process.env.NO_COLOR
const sgr = (open, close) => (s) => (TTY ? `\x1b[${open}m${s}\x1b[${close}m` : s)
const bold = sgr(1, 22)
const italic = sgr(3, 23)
const strike = sgr(9, 29)
const dim = sgr(2, 22)
const cyan = sgr(36, 39)
const yellow = sgr(33, 39)
const green = sgr(32, 39)

/**
 * Slack mrkdwn を端末の装飾へ落として「見え方」を近似する。
 * コード（``` と `）を先に退避するのは、その中の *  _  ~ を装飾として解釈しないため
 * （Slack 自身も同じ扱いをする）。
 */
function renderLikeSlack(text) {
  const stash = []
  const MARK = '\u0000PV'
  let out = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => {
    stash.push(m)
    return `${MARK}${stash.length - 1}${MARK}`
  })

  out = out.replace(/\*([^*\n]+)\*/g, (_m, s) => bold(s))
  out = out.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, (_m, pre, s) => `${pre}${italic(s)}`)
  out = out.replace(/~([^~\n]+)~/g, (_m, s) => strike(s))

  return out.replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_m, i) => {
    const raw = stash[Number(i)]
    // Slack はコードを等幅の枠で出す。端末では枠線の代わりに淡色＋記号を落として示す
    if (raw.startsWith('```')) {
      const body = raw.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
      return body
        .split('\n')
        .map((l) => dim('│ ') + l)
        .join('\n')
    }
    return dim('[') + raw.slice(1, -1) + dim(']')
  })
}

const indent = (s, pad) =>
  s
    .split('\n')
    .map((l) => pad + l)
    .join('\n')

function printOne(label, input) {
  const output = formatForSlack(input)
  const unchanged = output === input

  if (label) console.log(`\n${yellow('■ ' + label)}`)
  console.log(cyan('  ① LLM の生出力'))
  console.log(indent(input, '     ') || '     (空)')
  console.log(cyan(`  ② Slack へ送る文字列${unchanged ? dim('（変化なし）') : ''}`))
  console.log(indent(output, '     ') || '     (空)')
  console.log(cyan('  ③ Slack での見え方（近似）'))
  console.log(indent(renderLikeSlack(output), '     ') || '     (空)')
}

// ---- 代表例。T-0110 が対象にした5分類をそれぞれ1つずつ ----

const SAMPLES = [
  [
    '見出し（# は Slack に無い記法）',
    '## 二次方程式の解き方\n\n判別式から考えていこう。',
  ],
  [
    '強調（** は Slack では文字として出てしまう）',
    '**ポイント**は判別式だよ。*ここ*も押さえてね。\n~~前に言ったやり方~~ は忘れて大丈夫。',
  ],
  [
    '箇条書き（- は Slack では点にならない）',
    '手順:\n- 係数 a, b, c を確認する\n- 判別式を計算する\n  - 符号だけ見れば十分\n- 解の公式に入れる',
  ],
  [
    'コードブロック（中身は変換しない）',
    '```python\n# べき乗は ** で書く\nx = base ** 2\n```\n`**これ**` もコードのまま。',
  ],
  [
    'LaTeX の数式（Unicode に変換する）',
    '判別式は $D = b^2 - 4ac$ で、$D \\geq 0$ なら実数解があるよ。\n\\[ x = \\frac{-b \\pm \\sqrt{D}}{2a} \\]\n$x_1$ と $x_2$ を求めよう。$\\theta$ は角度、$a \\times b$ は積。',
  ],
  [
    '通常の日本語文（何も起きないことの確認）',
    '一緒に整理しよう！次のステップに進むよ。',
  ],
  [
    '混在（実際の回答に近い形）',
    '## 今回のポイント\n\n**判別式** $D = b^2 - 4ac$ の符号で解の個数が決まるよ。\n\n- $D > 0$ … 異なる2つの実数解\n- $D = 0$ … 重解\n- $D < 0$ … 実数解なし\n\n次は $D$ を自分で計算してみよう。',
  ],
]

// ---- 引数 ----

const argv = process.argv.slice(2)
const HELP = `formatForSlack() の変換結果を目で確認する。

  node scripts/preview-slack-format.mjs                 代表例をまとめて表示
  node scripts/preview-slack-format.mjs "## 見出し"      文字列を1つ試す
  node scripts/preview-slack-format.mjs --file <path>   ファイルの中身を試す
  cat x.txt | node scripts/preview-slack-format.mjs -   標準入力を試す
  node scripts/preview-slack-format.mjs --raw "..."     整形後の文字列だけを出す

  ③「Slack での見え方」は端末での近似です。最終確認は実機の Slack で行ってください。
`

if (argv[0] === '--help' || argv[0] === '-h') {
  process.stdout.write(HELP)
  process.exit(0)
}

async function readStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

let raw = false
const rest = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--raw') raw = true
  else if (argv[i] === '--file') {
    const path = argv[++i]
    if (!path) {
      console.error('エラー: --file にパスがありません')
      process.exit(1)
    }
    rest.push(await (await import('node:fs/promises')).readFile(path, 'utf8'))
  } else if (argv[i] === '-') rest.push(await readStdin())
  else rest.push(argv[i])
}

if (rest.length === 0) {
  console.log(dim('formatForSlack() の変換結果。--help で使い方。'))
  console.log(dim(`対象: src/shared/lib/slack/formatForSlack.ts  （Node v${process.versions.node}）`))
  for (const [label, input] of SAMPLES) printOne(label, input)
  console.log(
    `\n${green('自分の文章で試す:')} node scripts/preview-slack-format.mjs "ここに文章"\n` +
      dim('③ は端末での近似です。最終確認は実機の Slack で行ってください。\n'),
  )
} else {
  const input = rest.join('\n')
  if (raw) process.stdout.write(formatForSlack(input))
  else printOne(null, input)
}
