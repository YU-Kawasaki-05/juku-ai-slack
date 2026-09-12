/** @file
 * 機能: LLM が出力した標準 Markdown / LaTeX 混じりのテキストを Slack mrkdwn 向けに整形する
 * 入力: LLM 生成テキスト（escapeSlackText を通す前の生テキスト）
 * 出力: Slack 上で見出し記号・二重アスタリスク・生の LaTeX が文字として露出しない、
 *   mrkdwn として自然に表示されるテキスト
 * 例外: なし（純粋関数。変換できないパターンは元の形のまま素通しする）
 * 依存: なし。既存 npm パッケージ（例: slackify-markdown, md-to-slack）ではなく自前実装を選んだ理由:
 *   このボットが変換する Markdown は LLM のシステムプロンプトで統制された範囲
 *   （見出し・強調・箇条書き・基本的な数式）に限られ、テーブルやネスト構造まで扱う必要が無い。
 *   remark/unified ベースの汎用パッケージを入れるほどの複雑さではなく、対応漏れが出ても
 *   このファイル1つを直せば済む方が運用しやすい（T-0110）。
 * セキュリティ: この関数は `<` `>` `&` を一切生成しない。呼び出し順は必ず
 *   `escapeSlackText(formatForSlack(text))`（インジェクション対策のエスケープは投稿直前が最終防波堤）。
 * 数式方針（要件 T-0110 #2）: LaTeX (`$...$` `\(...\)` `\[...\]` `$$...$$`) を Unicode の
 *   上付き・下付き・記号（× ÷ √ ≤ など）に変換する（案a）。理由:
 *   - このボットの対象は中学・高校の数学で、範囲は分数・平方根・指数・不等号・ギリシャ文字程度に収まり、
 *     Unicode の対応表だけで大半をカバーできる（積分・行列などの高度な記法は対象外と割り切る）。
 *   - コードブロックに閉じ込める案(b)は説明文中に埋め込まれた数式（socratic/confirmation モードの
 *     確認質問など）には使えない。地の文と数式を分離すると分割注意（Split-Attention）を招く
 *     （docs/05_その他/AI精度_リサーチ/06.md）。
 *   - プロンプトで LaTeX 禁止(案c)だけに頼るのは、LLM が指示に従わない場合の保険が無くなるため、
 *     本関数を安全網として残しつつ buildPrompt.ts 側にも禁止指示を追加する（両方やる）。
 *   変換できない複雑な LaTeX（\begin{...} など）はそのまま素通しする（対象外）。
 *
 * 対象外と決めていること（「確かめていない」ではなく「やらないと決めた」もの）:
 *   - **4スペース字下げのコードブロック**（フェンス無しの Markdown の書き方）。保護しない。
 *     buildPrompt が ``` のフェンスしか指示していないため。LLM がこの形で出したら中身が変換される。
 *   - **`__word__` を太字として扱うこと自体の副作用**。両側が同じ語になる識別子
 *     （Python の `__init__` `__name__` など）はバッククォートで囲まないと `*init*` に化ける。
 *     対象が中高数学であること、buildPrompt が `__` の使用を禁じていることから、
 *     条件を足して複雑にするより、この挙動を受け入れる方を選んだ（テストで固定してある）。
 *   - 番号付きリスト・引用（`>`）・表。Slack に対応する記法が無く、素通しで読めるため。
 *   - **記号が混在した擬似的な水平線**（`*-*-*` など）。CommonMark の thematic break は
 *     同じ記号の繰り返しなので水平線として扱わず、`*` が1つ残ることがある。
 *     LLM がこの形を出す動機が無いため対応しない。
 * @implements T-0110
 */

// プレースホルダの目印。**入力に現れうる文字列を目印にしてはいけない**（独立監査 2026-09-12・P1）。
// 以前は '@@SFPH@@' という ASCII 記号列を使っていたが、生徒が LLM に「次の文字列をそのまま繰り返して」と
// 頼めば本文に混入させられ、①本文が無音で消える ②文字列 "undefined" が出る ③無関係なコードブロックの
// 中身にすり替わる、という破壊が起きた（過去実例 F5「冪等性ポイズニング」と同じ型）。
// 対策は2枚。(1) 目印に NUL を使い、formatForSlack の入口で入力から NUL を除去する
//     → 「入力が目印と一致する」経路が構造的に消える（予防）。
// (2) 復元時に自分が退避した範囲かを必ず確認し、外れていたら素通しに倒す
//     → 予防が破れても壊さない（検知ではなく安全側の既定）。
// 目印はこの関数の内部だけで生きて外へ出ないので、エンコーディングの心配は要らない。
const MARK = '\u0000SFPH\u0000'

/** フェンス付きコードブロック / インラインコードを退避し、変換対象から除外する */
function protectCode(text: string): { text: string; restore: (s: string) => string } {
  const blocks: string[] = []
  let i = 0
  const stash = (m: string): string => {
    blocks.push(m)
    return `${MARK}CODE${i++}${MARK}`
  }

  // 3連バッククォートのフェンス。**開始も終了も行頭にあるものだけ**をフェンスとみなす
  // （CommonMark と同じ扱い）。単純な非貪欲 /```[\s\S]*?```/ だと、コード見本として本文中に
  // 書かれた ``` を終端と誤認し、保護されるべき中身が変換されてしまう（独立監査 2026-09-12・P1）。
  // ⚠️ 開始行と終了行を**同じ形**で書いてはいけない（独立監査 2026-09-12・2巡目・P1）。
  // 開始行は言語指定（```js）を許すが、**終了行はバッククォートと空白だけ**でなければならない
  // （CommonMark と同じ）。対称に書くと「```js 補足」のような行を終端と誤認し、
  // そこから後ろのコードが変換されてしまう。
  let out = text.replace(/^[ \t]{0,3}```[^\n]*\n[\s\S]*?^[ \t]{0,3}```[ \t]*$/gm, stash)
  // 閉じていないフェンスは本文末尾までコードとして扱う（CommonMark と同じ）。
  // g を付けないのは、最初の1つが末尾まで飲み込むため2つ目以降が存在しないから。
  out = out.replace(/^[ \t]{0,3}```[\s\S]*/m, stash)
  // 残りのインラインコード（同じ行の中の `...`）を退避
  out = out.replace(/`[^`\n]+`/g, stash)

  const restoreRe = new RegExp(`${MARK}CODE(\\d+)${MARK}`, 'g')
  return {
    text: out,
    // 自分が退避していない番号なら、空文字にせず元の文字列のまま返す（本文を消さない）。
    // ⚠️ この分岐は **テストで到達できない**。protectCode は export しておらず、
    // formatForSlack の入口で NUL を落とす1枚目が立っている限り不一致が起きないため。
    // ミューテーション検査（この `?? m` を `?? ''` に戻す）でも落ちるテストは0件だった。
    // 「テストで守られている」とは書かない——1枚目を外す変更をしたら、ここも同時に見ること。
    restore: (s) => s.replace(restoreRe, (m, idx) => blocks[Number(idx)] ?? m),
  }
}

// ---- 数式（LaTeX → Unicode） ----

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
}
const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
}

/** 全文字がマップにあれば Unicode 上付き/下付きへ、1文字でも無ければ `^(...)` 表記へ後退する */
function mapOrFallback(
  s: string,
  map: Record<string, string>,
  fallbackWrap: (s: string) => string
): string {
  const chars = [...s]
  if (chars.length > 0 && chars.every((c) => c in map)) return chars.map((c) => map[c]).join('')
  return fallbackWrap(s)
}

/** ゼロ引数の LaTeX 記号マクロ → Unicode 記号。`\command` の英字を最長一致させるため
 *  マッチは `\\([a-zA-Z]+)` で行う（`\le` が `\leq` の前方一致で誤爆しないようにするため） */
const LATEX_SYMBOL_MAP: Record<string, string> = {
  times: '×',
  div: '÷',
  cdot: '·',
  pm: '±',
  mp: '∓',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  infty: '∞',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  cdots: '⋯',
  ldots: '…',
  dots: '…',
  sum: 'Σ',
  prod: 'Π',
  sqrt: '√',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  phi: 'φ',
  omega: 'ω',
  Delta: 'Δ',
  Sigma: 'Σ',
  Omega: 'Ω',
  Gamma: 'Γ',
  Pi: 'Π',
  Theta: 'Θ',
}

/**
 * `\(...\)` `\[...\]` `$...$` `$$...$$` の中身に対する記号変換本体。
 *
 * `bare = true` は区切り記号の外（＝ただの日本語の地の文）に当てるモード。
 * 地の文では `_` が数式の添字とは限らないため、下付き変換を
 * **「単独の英数字1文字 + `_`」の形だけ**に絞る。絞らないと `user_name` が `user_(n)ame` に、
 * `__bold__` が `__(b)old__` に化ける（変換の軸が対象の危険性と相関していない例）。
 */
function convertMathBody(input: string, bare = false): string {
  let s = input
  // \frac{a}{b} → (a)/(b)（中高数学の範囲ではネストしない分数がほとんどのため中括弧の入れ子は対象外）
  s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
  // \sqrt{a} → √(a)（\sqrt[n]{a} の n 乗根は対象外。中高数学では平方根が大半）
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
  // \text{a} → a（中身だけ残す）
  s = s.replace(/\\text\{([^{}]*)\}/g, '$1')
  // \left \right は括弧のサイズ指定のみなので除去し、\{ \} は素の中括弧に戻す
  s = s.replace(/\\left|\\right/g, '')
  s = s.replace(/\\([{}])/g, '$1')

  // 上付き/下付き（中括弧つきを先に処理）
  s = s.replace(/\^\{([^{}]+)\}/g, (_m, c) => mapOrFallback(c, SUPERSCRIPT_MAP, (x) => `^(${x})`))
  s = s.replace(/\^([0-9A-Za-z])/g, (_m, c) => mapOrFallback(c, SUPERSCRIPT_MAP, (x) => `^(${x})`))
  if (bare) {
    // 地の文。判定の軸は**基底の長さではなく、添字の後ろに語が続くか**。
    // 当初は「直前が単独の英数字1文字」で絞ったが、それだと中高数学で頻出の `ax_1` `bx_2`
    // （係数つきの変数）を取りこぼした（独立監査 2026-09-12・2巡目・P2）。
    // 添字は1文字で終わるのに対し、識別子（`user_name` `my_file`）は `_` の後ろに語が続く。
    // `(?![\w])` はその違いを直接見ている（`\w` は `_` を含むので `__bold__` も弾ける）。
    const sub = (c: string) => mapOrFallback(c, SUBSCRIPT_MAP, (x) => `_(${x})`)
    s = s.replace(/_\{([^{}]+)\}/g, (_m, c) => sub(c))
    s = s.replace(/_([0-9A-Za-z])(?![\w])/g, (_m, c) => sub(c))
  } else {
    s = s.replace(/_\{([^{}]+)\}/g, (_m, c) => mapOrFallback(c, SUBSCRIPT_MAP, (x) => `_(${x})`))
    s = s.replace(/_([0-9A-Za-z])/g, (_m, c) => mapOrFallback(c, SUBSCRIPT_MAP, (x) => `_(${x})`))
  }

  // ゼロ引数の記号マクロ（未知のコマンドはそのまま残す）
  s = s.replace(/\\([a-zA-Z]+)/g, (m, cmd: string) => LATEX_SYMBOL_MAP[cmd] ?? m)

  return s
}

/**
 * LaTeX の区切り記号を判定して中身を convertMathBody に通す。
 * `$...$` は通貨表記（例:「$5 です」）と衝突しうるため、`\` `^` `_` など
 * 数式らしい記号を含む場合だけ数式として扱う（含まなければ $ 記号ごと素通しする）。
 */
export function convertMath(text: string): string {
  let out = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => convertMathBody(inner))
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => convertMathBody(inner))
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => convertMathBody(inner))
  out = out.replace(/\$([^\n$]+?)\$/g, (m, inner) =>
    /[\\^_]/.test(inner) ? convertMathBody(inner) : m
  )
  // 区切り記号を使わずに書かれた素の LaTeX コマンドや ^ _ も拾う。
  // ただし地の文なので、下付きの判定だけは絞る（bare = true）
  out = convertMathBody(out, true)
  return out
}

// ---- Markdown → Slack mrkdwn ----

/**
 * 標準 Markdown の記法を Slack mrkdwn に変換する。
 * 太字/見出しはプレースホルダに退避してから他の変換を通し、最後に単一アスタリスクへ復元する
 * （復元を最後に回さないと、後段の斜体変換が見出し由来のアスタリスクを誤って斜体だと解釈する）。
 */
export function convertMarkdownToMrkdwn(text: string): string {
  let out = text
  const boldPlaceholders: string[] = []
  const pushBold = (inner: string): string => {
    boldPlaceholders.push(inner)
    return `${MARK}B${boldPlaceholders.length - 1}${MARK}`
  }
  const boldTokenRe = new RegExp(`^${MARK}B(\\d+)${MARK}$`)

  // 0-a. 水平線（`***` `---` `___` だけの行）を先に処理する。
  //    Slack に水平線の記法は無い。**畳み込みより先にここで取り除かないと、
  //    `***` だけの行が `**`（閉じられない太字の記号）になって画面に残る**
  //    （独立監査 2026-09-12・3巡目・P1。畳み込みを足したこと自体が新しい穴を開けた例）。
  out = out.replace(/^[ \t]{0,3}([*\-_])[ \t]*(?:\1[ \t]*){2,}$/gm, '──────────')

  // 0-b. 残った3連以上のアスタリスクを ** に畳む。`***強調***`（Markdown の太字＋斜体）や、
  //    LLM の揺れで出る `****text****` は、そのままだと太字にも斜体にもマッチせず
  //    `*_*text*_*` のような崩れ方をする（独立監査 2026-09-12・2巡目・P3）。
  //    Slack に太字＋斜体の複合記法は無いので、太字に寄せるのが素直。
  out = out.replace(/\*{3,}/g, '**')

  // 0-c. **半角スペースで挟まれた `**` は「べき乗の演算子」として先に退避する。**
  //    これをやらないと、演算子が2つある文（`a ** 2 で、b ** 2 です`）で
  //    1個目と2個目が太字の対と誤認され、**間の本文がまるごと太字になり、
  //    後ろにある本物の `**太字**` まで巻き込まれて壊れる**
  //    （独立監査 2026-09-12・5巡目・P0）。
  //    以前は後始末（step 7）の側で「前後がスペースなら残す」と書いていたが、
  //    **対の検出そのものが先に誤るので、後始末では間に合わなかった。**
  //    予防（対の候補から外す）と後始末（対にならなかったものを落とす）は別の仕事で、
  //    後者に前者の役目をさせていたのが誤り。
  const operatorPlaceholders: string[] = []
  out = out.replace(/(?<=[ \t])\*{2,}(?=[ \t])/g, (m) => {
    operatorPlaceholders.push(m)
    return `${MARK}OP${operatorPlaceholders.length - 1}${MARK}`
  })

  // 1. 太字 **text** / __text__ を退避。
  //    **改行を1つまたぐ太字も拾う**（独立監査 2026-09-12・P1）。LLM は段落全体を太字にすることがあり、
  //    改行を除外していると `**` が生徒の画面にそのまま残っていた。
  //    空行（段落の切れ目）はまたがない——またぐと、閉じ忘れた `**` が文書全体を飲み込む。
  const boldInner = String.raw`(?:[^*\n]|\n(?!\s*\n))+?`
  const underInner = String.raw`(?:[^_\n]|\n(?!\s*\n))+?`
  out = out.replace(new RegExp(`\\*\\*(${boldInner})\\*\\*`, 'g'), (_m, inner) => pushBold(inner))
  out = out.replace(new RegExp(`__(${underInner})__`, 'g'), (_m, inner) => pushBold(inner))

  // 2. 見出し # 〜 ###### → Slack に見出し記法は無いので太字1行にする
  //    （見出し全体が既に太字プレースホルダだけの場合は二重に太字化しない）
  out = out.replace(/^ {0,3}#{1,6}[ \t]+(.+)$/gm, (_m, inner: string) => {
    const already = inner.trim().match(boldTokenRe)
    return already ? `${MARK}B${already[1]}${MARK}` : pushBold(inner)
  })

  // 3. 打ち消し線 ~~text~~ → Slack は単一チルダ
  out = out.replace(/~~([^~\n]+?)~~/g, '~$1~')

  // 4. 箇条書きの行頭記号（-, *, + + 半角スペース）→ Slack には箇条書き記法が無いので中黒にする
  out = out.replace(/^(\s*)[-*+][ \t]+(?=\S)/gm, '$1• ')

  // 5. 斜体 *text*（前後が非空白の語のみ。"3 * 4" のような掛け算は誤変換しない）→ Slack は _text_
  //    太字・見出しは 1, 2 で既に退避済みなのでここに生きた ** は残っていない
  out = out.replace(/\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*/g, '_$1_')

  // 6. 太字プレースホルダを Slack の太字記法（単一アスタリスク）へ復元
  const restoreRe = new RegExp(`${MARK}B(\\d+)${MARK}`, 'g')
  // 自分が退避していない番号なら、"undefined" を出さず元の文字列のまま返す
  out = out.replace(restoreRe, (m, idx) => {
    const inner = boldPlaceholders[Number(idx)]
    return inner === undefined ? m : `*${inner}*`
  })

  // 7. **閉じないアスタリスクの後始末。** ここまでで正しく対になった太字は単一の `*` に
  //    なっているので、**2つ以上続くアスタリスクが残っていたら、それは閉じ損ねた記号**。
  //    Slack では意味を持たず、生徒の画面に記号として出るだけなので落とす。
  //
  //    なぜ個別のパターンではなく、この形にしたか（独立監査 2026-09-12・4巡目・P1）:
  //    3連を畳めば2連が残り、2連を潰せば次は別の境界値が残る、という後追いを3巡続けた。
  //    「何連か」で場合分けするのをやめ、「**対にならなかったマーカーは投稿前に落とす**」
  //    という1つの規則にしてある。トークン上限で開き `**` の直後に切れる経路
  //    （executeProcessMessage の TRUNCATED_ANSWER_NOTICE）が実運用で必ず通る。
  //
  //    べき乗の演算子は 0-c で退避済みなので、ここに残っているものは全部落としてよい。
  out = out.replace(/\*{2,}/g, '')

  // 8. 退避しておいたべき乗の演算子を戻す
  const opRestoreRe = new RegExp(`${MARK}OP(\\d+)${MARK}`, 'g')
  out = out.replace(opRestoreRe, (m, idx) => operatorPlaceholders[Number(idx)] ?? m)

  return out
}

/**
 * LLM 生成テキストを Slack 投稿用に整形する。呼び出し側は
 * `postMessage({ text: escapeSlackText(formatForSlack(answerText)) })` の順で使うこと
 * （escapeSlackText によるインジェクション対策は必ず最後、投稿直前に行う）。
 *
 * **べき等ではない**（既知の性質・独立監査 2026-09-12・P2）。出力の太字は Slack 記法の `*x*` だが、
 * これを再度この関数に通すと Markdown の斜体と区別できず `_x_` に化ける。単一アスタリスクが
 * 「変換済みの太字」なのか「これから変換する斜体」なのかは、文字列からは判別できない。
 * **したがって、この関数は投稿直前に1回だけ通すこと。**
 * 現在の呼び出し経路では二重適用は起きない（executeProcessMessage の ctx.resultText が
 * 保持するのは整形前の生テキストで、再配信時もそこから1回だけ整形する）。
 * 整形後のテキストを保存して再送する経路を将来作るなら、そこで必ずこの性質を確認すること。
 */
export function formatForSlack(text: string): string {
  // 目印に使う NUL を入力から除去する。表示できない制御文字なので落として実害は無く、
  // これで「入力がプレースホルダと衝突する」経路が構造的に消える（上の MARK のコメント参照）
  const { text: protectedText, restore } = protectCode(text.replace(/\u0000/g, ''))
  const withMath = convertMath(protectedText)
  const withMarkdown = convertMarkdownToMrkdwn(withMath)
  return restore(withMarkdown)
}
