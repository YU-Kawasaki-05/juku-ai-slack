/** @file
 * 検証: LLM 出力（標準 Markdown / LaTeX 混じり）を Slack mrkdwn へ整形する formatForSlack
 * @verifies T-0110
 */
import { describe, it, expect } from 'vitest'
import { formatForSlack, convertMarkdownToMrkdwn, convertMath } from './formatForSlack'
import { escapeSlackText } from './escapeSlackText'

describe('convertMarkdownToMrkdwn', () => {
  it('見出し # 〜 ###### を太字1行に変換する', () => {
    expect(convertMarkdownToMrkdwn('# 大見出し')).toBe('*大見出し*')
    expect(convertMarkdownToMrkdwn('## 中見出し')).toBe('*中見出し*')
    expect(convertMarkdownToMrkdwn('###### 深い見出し')).toBe('*深い見出し*')
  })

  it('見出し自体が太字の場合、アスタリスクを二重にしない', () => {
    expect(convertMarkdownToMrkdwn('### **重要な公式**')).toBe('*重要な公式*')
  })

  it('二重アスタリスクの太字を単一アスタリスクへ変換する（Slack 記法）', () => {
    expect(convertMarkdownToMrkdwn('これは**大事**なところ')).toBe('これは*大事*なところ')
  })

  it('__bold__ 記法も単一アスタリスクへ変換する', () => {
    expect(convertMarkdownToMrkdwn('これは__大事__なところ')).toBe('これは*大事*なところ')
  })

  it('単発アスタリスクの斜体をアンダースコアへ変換する', () => {
    expect(convertMarkdownToMrkdwn('これは*ポイント*だよ')).toBe('これは_ポイント_だよ')
  })

  it('掛け算の * を斜体だと誤認しない（前後に空白がある場合）', () => {
    expect(convertMarkdownToMrkdwn('3 * 4 = 12 で、5 * 6 = 30')).toBe('3 * 4 = 12 で、5 * 6 = 30')
  })

  it('打ち消し線 ~~text~~ を単一チルダへ変換する', () => {
    expect(convertMarkdownToMrkdwn('~~誤り~~ 訂正後')).toBe('~誤り~ 訂正後')
  })

  it('箇条書きの行頭記号を中黒に変換する（-, *, +）', () => {
    const input = '手順:\n- 一つ目\n* 二つ目\n+ 三つ目'
    expect(convertMarkdownToMrkdwn(input)).toBe('手順:\n• 一つ目\n• 二つ目\n• 三つ目')
  })

  it('行頭以外のハイフン（引き算・範囲）は箇条書きにしない', () => {
    expect(convertMarkdownToMrkdwn('5 - 3 = 2')).toBe('5 - 3 = 2')
  })

  it('箇条書きの行頭インデントを保持する', () => {
    expect(convertMarkdownToMrkdwn('  - ネストした項目')).toBe('  • ネストした項目')
  })

  it('マークダウン記法を含まない通常の日本語文はそのまま', () => {
    const text = '一緒に整理しよう！次のステップに進むよ。'
    expect(convertMarkdownToMrkdwn(text)).toBe(text)
  })
})

describe('convertMath', () => {
  it('インライン数式 $...$ の指数を Unicode 上付きに変換する', () => {
    expect(convertMath('二次関数 $x^2$ を考えよう')).toBe('二次関数 x² を考えよう')
  })

  it('\\( ... \\) 形式も変換する', () => {
    expect(convertMath('面積は \\(x^2\\) で求まる')).toBe('面積は x² で求まる')
  })

  it('\\[ ... \\] 形式（ディスプレイ数式）も変換する', () => {
    expect(convertMath('\\[ a^2 + b^2 = c^2 \\]')).toBe(' a² + b² = c² ')
  })

  it('$$ ... $$ 形式も変換する', () => {
    expect(convertMath('$$x^2$$')).toBe('x²')
  })

  it('分数 \\frac{a}{b} を a/b 形式にする', () => {
    expect(convertMath('$\\frac{1}{2}$')).toBe('(1)/(2)')
  })

  it('平方根 \\sqrt{x} を √(x) にする', () => {
    expect(convertMath('$\\sqrt{2}$')).toBe('√(2)')
  })

  it('比較演算子・ギリシャ文字を Unicode に変換する', () => {
    expect(convertMath('$x \\leq 5$')).toBe('x ≤ 5')
    expect(convertMath('$\\theta$ は角度')).toBe('θ は角度')
    expect(convertMath('$a \\times b$')).toBe('a × b')
  })

  it('下付き文字 x_1 を Unicode 下付きに変換する', () => {
    expect(convertMath('$x_1 + x_2$')).toBe('x₁ + x₂')
  })

  it('複数文字・非対応文字の指数は ^(...) 表記にフォールバックする', () => {
    expect(convertMath('$x^{ab}$')).toBe('x^(ab)')
  })

  it('数式らしい記号を含まない $...$ は通貨表記とみなしそのまま', () => {
    expect(convertMath('ランチは$5でした')).toBe('ランチは$5でした')
  })

  it('区切り記号が無い素の LaTeX コマンドも変換する', () => {
    expect(convertMath('答えは x^2 \\times 3 だよ')).toBe('答えは x² × 3 だよ')
  })

  it('未対応の複雑な LaTeX はそのまま素通しする（対象外と明記した範囲）', () => {
    expect(convertMath('\\begin{matrix}1&2\\end{matrix}')).toContain('matrix')
  })
})

describe('formatForSlack（結合）', () => {
  it('見出し・太字・箇条書き・数式が混在する回答を Slack 向けに整形する', () => {
    const llmOutput = [
      '## 二次方程式の解き方',
      '',
      '**ポイント**は判別式を使うことだよ。',
      '',
      '手順:',
      '- 係数 a, b, c を確認する',
      '- 判別式 $D = b^2 - 4ac$ を計算する',
      '- $D \\geq 0$ なら実数解がある',
    ].join('\n')

    const result = formatForSlack(llmOutput)

    // 崩れの原因だった記号がそのまま残っていない
    expect(result).not.toContain('##')
    expect(result).not.toContain('**')
    expect(result).not.toMatch(/^- /m)
    expect(result).not.toContain('$D')
    expect(result).not.toContain('\\geq')

    // 期待どおりの Slack mrkdwn / Unicode 数式になっている
    expect(result).toContain('*二次方程式の解き方*')
    expect(result).toContain('*ポイント*')
    expect(result).toContain('• 係数 a, b, c を確認する')
    expect(result).toContain('D = b² - 4ac')
    expect(result).toContain('D ≥ 0')
  })

  it('フェンス付きコードブロックの中身は変換しない（Python の # コメントや ** を壊さない）', () => {
    const llmOutput = ['```python', '# これはコメント', 'x = base ** 2  # べき乗', '```'].join('\n')

    const result = formatForSlack(llmOutput)
    expect(result).toBe(llmOutput)
  })

  it('インラインコードの中身は変換しない', () => {
    expect(formatForSlack('`**not bold**` はコードのまま')).toBe('`**not bold**` はコードのまま')
  })

  it('direct モードで指示している「式と説明を同じ行のコードブロック」はそのまま活きる', () => {
    const llmOutput = ['```', 'F = m * a          // ニュートンの第2法則', '```'].join('\n')
    expect(formatForSlack(llmOutput)).toBe(llmOutput)
  })

  it('escapeSlackText と組み合わせても <, >, & を新たに生成しない（C-3 との整合）', () => {
    const llmOutput = '# 注意\n**x < 5** かつ x > 2 のとき & 考える'
    const formatted = formatForSlack(llmOutput)
    // escapeSlackText を後段に通しても injection 対策の文字列表現は変わらない
    expect(escapeSlackText(formatted)).toBe('*注意*\n*x &lt; 5* かつ x &gt; 2 のとき &amp; 考える')
  })

  it('マークダウン・数式記法を含まない通常の回答は変化しない（回帰防止）', () => {
    const text = '一緒に整理しよう！次のステップに進むよ。'
    expect(formatForSlack(text)).toBe(text)
  })
})

// 以下は独立検査（2026-09-12・inspections/コード.md／判定=不合格）で実際に破壊を再現できた入力。
// 検査官のレポート: operator-ops の log/automation/inspections/
//   20260912-120111-405421-de4e51-コード-formatForSlack.ts.md
// 「テストが通る」は「テストがある」を意味しない。ここは直した穴を二度と開けないための固定。
describe('formatForSlack（独立検査で見つかった破壊の回帰防止）', () => {
  describe('プレースホルダ衝突（P1）', () => {
    // 生徒は LLM に「次の文字列をそのまま繰り返して」と頼める。内部の目印と一致する文字列を
    // 本文に混入させられると、①本文が消える ②"undefined" が出る ③無関係なコードにすり替わる、が起きた。
    it('目印に似た文字列があっても本文を消さない', () => {
      const input = '設問の答えは @@SFPH@@CODE0@@SFPH@@ です。'
      expect(formatForSlack(input)).toBe(input)
    })

    // ⚠️ この2件は検証している対象が違う。名前を実態に合わせてある（独立監査 2巡目・P2 の指摘）。
    // 目印は NUL ベースなので、ASCII の '@@SFPH@@...' はもう内部の目印と衝突しない。
    // つまり下の1件目が守っているのは「目印を ASCII 記号列に戻さないこと」であって、
    // 復元の境界チェックそのものではない（境界チェックは convertMarkdownToMrkdwn 単体の方で守る）。
    it('かつて壊せた ASCII の目印は、もう何の効果も持たない', () => {
      const input = '@@SFPH@@B5@@SFPH@@ のような、存在しないインデックスを騙る場合'
      expect(formatForSlack(input)).toBe(input)
    })

    it('本物の目印（NUL 入り）を混ぜられても "undefined" を出力しない', () => {
      const forged = '\u0000SFPH\u0000B5\u0000SFPH\u0000 を騙る'
      const result = formatForSlack(forged)
      expect(result).not.toContain('undefined')
      // NUL は入口で落ちるので、残るのは無害なただの文字列
      expect(result).toBe('SFPHB5SFPH を騙る')
    })

    it('無関係なコードブロックの中身にすり替わらない', () => {
      const result = formatForSlack('@@SFPH@@CODE0@@SFPH@@ **本当は太字** `本当はコード`')
      expect(result).toContain('@@SFPH@@CODE0@@SFPH@@')
      expect(result).toContain('*本当は太字*')
      expect(result).toContain('`本当はコード`')
    })

    it('内部の目印に使う NUL は入力から取り除く（表示できない制御文字）', () => {
      expect(formatForSlack('あ\u0000い')).toBe('あい')
    })

    // 2枚目の防御。formatForSlack 経由では NUL 除去（1枚目）で到達しないが、
    // convertMarkdownToMrkdwn は export されていて単体でも呼べるため、ここは実際に到達する。
    it('目印を直接渡されても "undefined" を作らない（convertMarkdownToMrkdwn 単体）', () => {
      const forged = '\u0000SFPH\u0000B5\u0000SFPH\u0000 を騙る'
      expect(convertMarkdownToMrkdwn(forged)).toBe(forged)
    })
  })

  describe('複数行の太字（P1: 受け入れ基準①違反だった）', () => {
    it('改行をまたぐ **太字** も変換する（LLM は段落全体を太字にすることがある）', () => {
      const result = formatForSlack('**今日のポイントは\n判別式の符号です**')
      expect(result).not.toContain('**')
      expect(result).toBe('*今日のポイントは\n判別式の符号です*')
    })

    it('空行（段落の切れ目）はまたがない＝閉じ忘れた ** が文書全体を飲み込まない', () => {
      const input = '**閉じ忘れた太字\n\n次の段落です。**別の太字**'
      const result = formatForSlack(input)
      expect(result).toContain('*別の太字*')
      expect(result).toContain('**閉じ忘れた太字')
    })
  })

  describe('入れ子のコードフェンス（P1: 受け入れ基準③違反だった）', () => {
    it('コード見本として書かれた ``` を終端と誤認しない', () => {
      const input = ['```', '例: ```**text**``` は生の```で囲む', '```', '**本当の太字**'].join('\n')
      const result = formatForSlack(input)
      // フェンスの中身（**text**）は保護されたまま
      expect(result).toContain('```**text**```')
      // フェンスの外（**本当の太字**）はきちんと変換される
      expect(result).toContain('*本当の太字*')
    })

    it('閉じていないフェンスは本文末尾までコードとして扱う', () => {
      const input = '```python\n# 見出しではないコメント\n**べき乗**'
      expect(formatForSlack(input)).toBe(input)
    })

    // 開始行は言語指定を許すが、閉じ行はバッククォートと空白だけ（CommonMark と同じ）。
    // 対称に書くと「```js 補足」を終端と誤認し、そこから後ろのコードが変換される。
    it('言語指定つきの行を閉じフェンスと誤認しない', () => {
      const input = ['```', 'a = 1', '```js これは本当は閉じてない例', 'b = 2  # **not bold**', '```'].join('\n')
      expect(formatForSlack(input)).toBe(input)
    })
  })

  describe('地の文のアンダースコアを壊さない', () => {
    it('snake_case を下付き文字に化けさせない', () => {
      expect(formatForSlack('変数 user_name に代入してね')).toBe('変数 user_name に代入してね')
      expect(formatForSlack('my_file.txt を開いて')).toBe('my_file.txt を開いて')
    })

    it('ASCII の __bold__ も日本語と同じく太字になる（言語で結果が変わらない）', () => {
      expect(formatForSlack('これは__bold__なところ')).toBe('これは*bold*なところ')
      expect(formatForSlack('これは__大事__なところ')).toBe('これは*大事*なところ')
    })

    it('数式の添字は従来どおり変換する（絞り込みで壊していないこと）', () => {
      expect(formatForSlack('$x_1 + x_2$')).toBe('x₁ + x₂')
      expect(formatForSlack('答えは x^2 \\times 3 だよ')).toBe('答えは x² × 3 だよ')
    })

    // 中高数学では係数つきの変数が頻出する。基底の長さで絞ると、ここを丸ごと取りこぼす。
    it('係数つきの変数の添字も変換する（ax_1 / bx_2）', () => {
      expect(formatForSlack('ax_1 + bx_2 = c')).toBe('ax₁ + bx₂ = c')
    })
  })

  describe('水平線（Slack に記法が無い）', () => {
    // 畳み込み処理を足したことで新たに壊れた箇所。`***` だけの行が `**` になって
    // 画面に残っていた（独立監査 3巡目・P1）。
    it('*** だけの行を Slack に出せる区切りに変える（** を残さない）', () => {
      const result = formatForSlack('上の説明\n\n***\n\n下の説明')
      expect(result).not.toContain('**')
      expect(result).toBe('上の説明\n\n──────────\n\n下の説明')
    })

    it('--- と ___ と長い並びも同じ扱い', () => {
      expect(formatForSlack('---')).toBe('──────────')
      expect(formatForSlack('___')).toBe('──────────')
      expect(formatForSlack('*****')).toBe('──────────')
      expect(formatForSlack('- - -')).toBe('──────────')
    })

    it('箇条書きの行頭記号を水平線と誤認しない', () => {
      expect(formatForSlack('- 一つ目\n- 二つ目')).toBe('• 一つ目\n• 二つ目')
    })

    it('コードブロックの中の区切り線は触らない', () => {
      const input = '```\n***\n```'
      expect(formatForSlack(input)).toBe(input)
    })
  })

  describe('連続アスタリスク', () => {
    it('*** や **** を太字に寄せる（Slack に太字＋斜体の複合記法は無い）', () => {
      expect(formatForSlack('***重要***')).toBe('*重要*')
      expect(formatForSlack('****太字****')).toBe('*太字*')
    })

    it('掛け算の単独アスタリスクは畳まない', () => {
      expect(formatForSlack('3 * 4 = 12')).toBe('3 * 4 = 12')
    })
  })

  describe('べき等ではないという既知の性質（P2）', () => {
    // 単一アスタリスクが「変換済みの太字」か「これから変換する斜体」かは文字列から判別できない。
    // 直すのではなく「1回だけ通す」を守る設計にしてあるので、その前提をここで固定する。
    // この前提が崩れる（整形後テキストを保存して再送する）変更を入れたら、このテストが道標になる。
    it('二重適用すると太字が斜体に化ける＝投稿直前に1回だけ通すこと', () => {
      const once = formatForSlack('## 見出し\n**太字**')
      expect(once).toBe('*見出し*\n*太字*')
      expect(formatForSlack(once)).toBe('_見出し_\n_太字_')
    })

    it('記法を含まない通常の回答は何度通しても変わらない', () => {
      const text = '一緒に整理しよう！次のステップに進むよ。'
      expect(formatForSlack(formatForSlack(text))).toBe(text)
    })
  })
})
