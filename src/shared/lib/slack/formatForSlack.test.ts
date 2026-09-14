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
      // またいでいたら「閉じ忘れた太字〜別の太字」が丸ごと1つの太字になる。
      // またがないので、後ろの対になった太字だけが太字になり、前の閉じ忘れは記号が落ちる。
      const input = '**閉じ忘れた太字\n\n次の段落です。**別の太字**'
      expect(formatForSlack(input)).toBe('閉じ忘れた太字\n\n次の段落です。*別の太字*')
    })
  })

  describe('閉じないアスタリスクの後始末（4巡目・P1）', () => {
    // 3連を畳めば2連が残り、2連を潰せば次の境界値が残る、という後追いを3巡続けた。
    // 「何連か」で場合分けするのをやめ、「対にならなかったマーカーは落とす」1規則にした。
    it('トークン上限で開き ** の直後に切れても記号を残さない（実運用で通る経路）', () => {
      const truncated =
        'ここまでの説明が終わって、次に大事なのは**' +
        '\n\n（文字数の上限で途中までになっちゃった。「続きを教えて」と送ってくれたら続きを説明するよ）'
      expect(formatForSlack(truncated)).not.toContain('**')
    })

    it('アスタリスク2つだけ・閉じ忘れ・3つ以上、どの本数でも残さない', () => {
      expect(formatForSlack('**')).toBe('')
      expect(formatForSlack('**太字 が閉じてない')).toBe('太字 が閉じてない')
      expect(formatForSlack('説明****とちゅう')).toBe('説明とちゅう')
    })

    it('前後を半角スペースで挟まれたべき乗は消さない（掛け算の * と同じ判断軸）', () => {
      expect(formatForSlack('x = base ** 2 だよ')).toBe('x = base ** 2 だよ')
    })

    // 5巡目・P0。1つだけのケースしかテストしておらず、**2つ以上あると
    // 1個目と2個目が太字の対と誤認されて、間の本文ごと壊れていた**。
    // 「テストが通る」は「テストが十分」を意味しない、の実例。
    it('べき乗が同じ文に2つ以上あっても壊れない', () => {
      expect(formatForSlack('aの2乗は a ** 2 で、bの2乗は b ** 2 です')).toBe(
        'aの2乗は a ** 2 で、bの2乗は b ** 2 です',
      )
      expect(formatForSlack('x ** 2 と y ** 2 と z ** 2')).toBe('x ** 2 と y ** 2 と z ** 2')
    })

    it('べき乗のあとに本物の太字が来ても、両方とも壊れない', () => {
      expect(formatForSlack('x ** 2 を計算してから、**答え合わせ**をしよう')).toBe(
        'x ** 2 を計算してから、*答え合わせ*をしよう',
      )
    })

    // 内側が空いた `** text **` は Markdown の太字ではない（CommonMark の flanking 規則）。
    // Slack も `* x *` を強調として描かないので、記号を残しても生徒には記号が見えるだけ。
    // **記号を落として地の文にする**方を選んだ。emphasis を1つ失うが、画面は汚れない。
    it('内側が空いた ** は太字にせず、記号も残さない', () => {
      expect(formatForSlack('これは ** 太字のつもり ** だよ')).toBe('これは  太字のつもり  だよ')
      expect(formatForSlack('参考: ** ヒント1 ** と ** ヒント2 ** を見て')).toBe(
        '参考:  ヒント1  と  ヒント2  を見て',
      )
    })

    // 7巡目・P0。演算子かどうかを「隣が ASCII 英数字か」で当てにいったら、
    // **全角数字や引用符の隣にある ** が後ろの本物の太字のマーカーを奪った**。
    // 対の検出を flanking 規則に移したので、隣に何があっても奪えなくなった。
    it('全角や記号の隣にある ** が、後ろの本物の太字を壊さない', () => {
      expect(formatForSlack('１ ** ２ のあと **重要** って書く')).toBe(
        '１ ** ２ のあと *重要* って書く',
      )
      expect(formatForSlack('"base" ** "exp" のあと **重要** って書く')).toContain('*重要*')
    })

    it('コードブロックの中のべき乗も当然そのまま', () => {
      const input = '```\nx = base ** 2\n```'
      expect(formatForSlack(input)).toBe(input)
    })
  })

  describe('受け入れた制限（直さないと決めたもの・4巡目・P2/P3）', () => {
    // 条件を足して複雑にするより、この挙動を受け入れる方を選んだ。
    // 対象が中高数学であること、buildPrompt が __ の使用を禁じていることが根拠。
    // 気が変わったときに「どこが変わるか」が分かるよう、現状をここで固定しておく。
    it('両側が同じ語の識別子は太字として解釈される（__init__ など）', () => {
      expect(formatForSlack('__name__ が "__main__" のとき')).toBe('*name* が "*main*" のとき')
      // バッククォートで囲めば壊れない。これが回避策。
      expect(formatForSlack('`__init__` メソッド')).toBe('`__init__` メソッド')
    })

    it('4スペース字下げのコードブロックは保護しない（フェンスのみ対応）', () => {
      expect(formatForSlack('    x = **1**')).toBe('    x = *1*')
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

    // 本数を決め打ちしていたため、開き3本・閉じ4本（CommonMark では合法）で
    // 閉じを見つけられず、**それ以降の本文が丸ごとコード扱いになって未変換のまま**
    // 生徒の画面に出ていた（18巡目・P1）。開きの本数以上を閉じと認める。
    it('閉じフェンスが開きより多くても閉じと認める', () => {
      const input = ['```', 'x = **1**', '````', '**本当の太字**'].join('\n')
      const result = formatForSlack(input)
      expect(result).toContain('*本当の太字*')
      expect(result).not.toContain('**本当の太字**')
    })

    it('4本以上のフェンスも対で認める', () => {
      const input = ['````', 'x = **1**', '````', '**本当の太字**'].join('\n')
      expect(formatForSlack(input)).toContain('*本当の太字*')
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

  describe('プレースホルダの入れ子（不変条件テストで発見）', () => {
    // 7巡の独立検査がどれも試さなかった組み合わせ。見出しの中に太字があると、
    // 太字を退避した文字列ごと見出しとして再度退避され、目印の中に目印が入る。
    // String.replace は置換結果を読み直さないので、1回だけ復元すると
    // **内部の目印（制御文字）がそのまま生徒の画面に出ていた**。
    it('見出しの中に太字があっても内部の目印が漏れない', () => {
      const result = formatForSlack('## まとめ **大事** です')
      expect(result).not.toContain('\u0000')
      // 見出しは行全体が太字になるので、中の太字は入れ子にせず平らにする
      expect(result).toBe('*まとめ 大事 です*')
    })

    it('見出しがまるごと太字のときは二重にしない（従来どおり）', () => {
      expect(formatForSlack('### **重要な公式**')).toBe('*重要な公式*')
    })

    it('中身の無い見出し記号は落とす（末尾の空白が何個でも同じ）', () => {
      // 空白1つと2つで挙動が変わっていた。見出しの中身を (\S.*?) にして揃えた。
      expect(formatForSlack('abc\n\n## ')).toBe('abc\n\n')
      expect(formatForSlack('abc\n\n##  \n\ndef')).toBe('abc\n\n\n\ndef')
    })
  })

  describe('見出しの中の他の記法（8巡目・P1）', () => {
    // 見出しは行全体を退避するので、**打ち消し線や斜体より先に実行すると
    // 見出しの中の記法が変換されずに記号のまま残る**。太字だけ専用の平坦化で
    // 救っていたのが誤りで、順番を後ろにすれば全部の記法が自然に通る。
    it('見出しの中の打ち消し線を変換する', () => {
      expect(formatForSlack('## 見出し ~~打ち消し~~')).toBe('*見出し ~打ち消し~*')
    })

    it('見出しの中の斜体を変換する', () => {
      expect(formatForSlack('## 見出し *斜体* です')).toBe('*見出し _斜体_ です*')
    })

    it('見出しの中の数式と箇条書き記号も従来どおり', () => {
      expect(formatForSlack('## 判別式 $D = b^2 - 4ac$')).toBe('*判別式 D = b² - 4ac*')
    })
  })

  describe('見出しの中の閉じないマーカー（9巡目・P1）', () => {
    // 見出しは中身を丸ごと退避して `*...*` で包むので、**中に閉じ損ねが残っていると
    // 包んだ記号と数が合わず、孤立した `*` が出力に残る**。
    // 後始末を「見出しで包む前」にも通すことで解決した。
    it('見出しの中の閉じない太字を、記号ごと落とす', () => {
      expect(formatForSlack('## **閉じない太字')).toBe('*閉じない太字*')
      expect(formatForSlack('## text**')).toBe('*text*')
      expect(formatForSlack('## **二次方程式を解こう')).toBe('*二次方程式を解こう*')
    })

    it('見出しでない行では従来どおり（同じ保証が両方で成り立つ）', () => {
      expect(formatForSlack('見出しでない普通の文 **閉じない太字')).toBe(
        '見出しでない普通の文 閉じない太字',
      )
    })
  })

  describe('べき乗と入れ子（12巡目・P0/P1/P2）', () => {
    // **事実と違う数式を生徒に出していた。**記号も残らずエラーも出ない、無音の破壊。
    it('英数字に挟まれたべき乗を消さない', () => {
      expect(formatForSlack('2**10 は 1024 です')).toBe('2**10 は 1024 です')
      expect(formatForSlack('x**2+y**2=z**2')).toBe('x**2+y**2=z**2')
    })

    // 退避は「後の変換から中身を隠す」。隠したままだと中の記法が生の記号で出る。
    // 外側がどの装飾でも、中の記法は必ず平らにする。
    it('太字が他の記法を包んでも、中の記号を残さない', () => {
      expect(formatForSlack('**~~打ち消し~~**')).toBe('*~打ち消し~*')
      expect(formatForSlack('**__x__**')).toBe('*x*')
    })

    it('対にならない ~~ も落とす（** と同じ扱い）', () => {
      expect(formatForSlack('~~閉じていない打ち消し')).toBe('閉じていない打ち消し')
    })

    // 直さないと決めたもの。記号は残らないが、外側の太字は失われる。
    // 打ち消し線を挟む形も同じ（15巡目・P2）。記号が残らないことだけは守る。
    it('太字が単一アスタリスクの斜体を内包すると、外側の太字は落ちる（既知）', () => {
      expect(formatForSlack('**a *b* c**')).toBe('a _b_ c')
      const nested = formatForSlack('**太字 ~~消し線 *斜体* 続き~~ 続太字**')
      expect(nested).toBe('太字 ~消し線 _斜体_ 続き~ 続太字')
      expect(nested).not.toContain('**')
      expect(nested).not.toContain('~~')
    })
  })

  describe('装飾の入れ子（11巡目・P0/P1）', () => {
    // Slack は装飾の入れ子を素直には解釈しない。見出しと同じ判断で、
    // **外側の装飾を残して中身を平らにする**。内側の記号を画面に出さない。
    it('斜体が太字を包む形で、内側の記号を残さない', () => {
      expect(formatForSlack('*__word__*')).toBe('_word_')
      expect(formatForSlack('文中に*__太字語__*を入れる')).toBe('文中に_太字語_を入れる')
    })

    it('太字の両側に地の文の記号がある形でも壊れない', () => {
      expect(formatForSlack('x*__y__*z')).toBe('x_y_z')
      expect(formatForSlack('x*__y__*z')).not.toContain('*')
    })
  })

  describe('地の文の記号と、復元で作る記号が隣り合う場合（10巡目・P1/P2）', () => {
    // 後始末は「地の文の `*`」と「自分が復元で作った `*`」を見分けられない。
    // 隣り合うと、掛け算の記号も強調も両方壊れていた。そもそも隣り合わせない。
    it('掛け算の記号のすぐ後ろに太字が来ても、掛け算を壊さない', () => {
      expect(formatForSlack('答えは2*__倍__になる')).toBe('答えは2*倍になる')
      expect(formatForSlack('x*__y__')).toBe('x*y')
      expect(formatForSlack('__y__*x')).toBe('y*x')
    })

    // 2枚目の後始末（復元のあと）が実際に効く場面。
    // 復元した太字どうしが隣り合うと、そこで初めて `**` が生まれる。
    it('復元した太字どうしが隣り合っても記号を残さない', () => {
      expect(formatForSlack('__a____b__')).toBe('*ab*')
      expect(formatForSlack('**a****b**')).not.toContain('**')
    })
  })

  describe('強調の対象を手で列挙しない（9巡目・P2）', () => {
    // 8巡目で「かな・漢字・英数字」を並べたら、**ギリシャ文字が漏れて `*` が残った**。
    // 除外方向でも許可方向でも、手で並べた集合は必ず漏れる。
    // Unicode の「文字か数字か」の分類をそのまま使う。
    it('ギリシャ文字1文字の強調も変換する', () => {
      expect(formatForSlack('*θ*は角度を表す')).toBe('_θ_は角度を表す')
      expect(formatForSlack('*π*を使う')).toBe('_π_を使う')
      expect(formatForSlack('*Ω*')).toBe('_Ω_')
    })

    // 3回目の漏れ。\p{L}|\p{N} では数学記号が落ちた。buildPrompt が
    // 「×、÷、≤、≥ を平文で使う」と指示しているので実運用で出る。
    it('数学記号だけの強調も変換する（13巡目・P1）', () => {
      for (const [input, want] of [
        ['*×*', '_×_'],
        ['*≤*', '_≤_'],
        ['*÷*', '_÷_'],
        ['*→*', '_→_'],
        ['*≠*', '_≠_'],
      ]) {
        expect(formatForSlack(input)).toBe(want)
      }
    })
  })

  describe('顔文字を斜体にしない（8巡目・P2 / 14巡目・P1）', () => {
    // **文字の種類では決められない。** `≧` は数式の内容にも顔文字の部品にもなり、
    // 同じ文字集合を共有しているので、どんな文字集合を選んでも両立しない。
    // 日本語の顔文字は `(*…*)` と括弧で包む形が定型なので、**構造で見る。**
    // 中身は一切見ない。「かつ中身に文字も数字も無いこと」という条件を足したら、
    // ω д ﾟ ① のような**顔文字によく使われる文字が「語」と判定されて壊れた**
    // （15巡目・P0。同型の5回目）。**条件を足すたびに、その条件がまた漏れを持ち込んだ。**
    it('括弧で直に包まれた *…* は、中身が何であれ強調にしない', () => {
      for (const s of [
        '(*^^*) がんばって！',
        '(*_*) すごい',
        '(*+_+*)',
        '(*≧▽≦*)',
        '(*=^_^=*)',
        '(*￣∇￣*)',
        '（*≧▽≦*）',
        '(*´ω`*)',
        '(*ﾟ∀ﾟ*)',
        '(*´д`*)',
        '(*①*)',
        'がんばって(*´ω`*)ね',
      ]) {
        expect(formatForSlack(s)).toBe(s)
      }
    })

    // 顔文字が太字に隣接した瞬間に、括弧の直前直後を見る守りは破綻していた
    // （16巡目・P0。顔文字破壊の6回目）。括弧の内側を見るのをやめ、
    // **コードと同じように最初に退避して隠す**ようにした。
    it('顔文字が太字に隣接しても壊れない', () => {
      expect(formatForSlack('よくできたね！**(*^^*)** この調子でがんばろう')).toBe(
        'よくできたね！(*^^*) この調子でがんばろう',
      )
      expect(formatForSlack('**(*^^*)**')).toBe('(*^^*)')
      expect(formatForSlack('**よくできたね (*^^*)**')).toBe('よくできたね (*^^*)')
    })

    // 記号を落とすか変換して残すかのどちらでもない「痕跡なく消える」壊れ方をしていた。
    it('太字の中に単独アスタリスクがあっても、末尾の記号が痕跡なく消えない', () => {
      expect(formatForSlack('**(x*y)**')).toBe('(x*y)')
    })

    it('斜体で包まれた顔文字も、太字側と同じ扱いにする（非対称を消す）', () => {
      expect(formatForSlack('*(*^^*)*')).toBe('(*^^*)')
    })

    // 対象外と決めたもの。顔文字を守るために、その顔文字を含むスパン全体が無強調になる。
    it('顔文字を含む強調は、スパン全体が無強調になる（既知の代償）', () => {
      expect(formatForSlack('**すごい (*^^*) がんばって**')).toBe('すごい (*^^*) がんばって')
      expect(formatForSlack('## まとめ (*^^*) だよ')).toBe('まとめ (*^^*) だよ')
    })

    // 代償。Slack はこれを太字として描くので記号は画面に出ない。
    // 括弧つきの強調より顔文字の方が実際に多いので、こちらを取った。
    it('括弧つきの強調は変換しない（受け入れた代償）', () => {
      expect(formatForSlack('(*大事*)')).toBe('(*大事*)')
    })

    it('通常の強調は従来どおり', () => {
      expect(formatForSlack('これは*ポイント*だよ')).toBe('これは_ポイント_だよ')
      expect(formatForSlack('これは*ABC*だよ')).toBe('これは_ABC_だよ')
    })
  })

  describe('$...$ を数式とみるか通貨とみるか', () => {
    // 当初は「中身に \\ ^ _ を含むか」で判定していたため、記号を含まない普通の数式
    // （$D > 0$ や $D$）がドル記号のまま生徒の画面に出ていた。
    it('記号を含まない数式もドル記号を外して変換する', () => {
      expect(formatForSlack('- $D > 0$ … 異なる2つの実数解')).toBe('• D > 0 … 異なる2つの実数解')
      expect(formatForSlack('$D$ を計算しよう')).toBe('D を計算しよう')
      expect(formatForSlack('$a + b = c$')).toBe('a + b = c')
    })

    it('通貨表記は触らない（日本語を挟む・英字を含まない）', () => {
      expect(formatForSlack('ランチは$5でした')).toBe('ランチは$5でした')
      expect(formatForSlack('ランチは$5、ディナーは$10でした')).toBe('ランチは$5、ディナーは$10でした')
    })

    it('日本語を含む数式は LaTeX コマンドの側で拾う', () => {
      expect(formatForSlack('$\\text{答え} = 5$')).toBe('答え = 5')
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
    // かつては「3連以上を ** に畳む」処理で太字に寄せていたが、その畳み込みが
    // `**a***b*`（太字の閉じ＋斜体の開き）の正当な境界を潰していたので削除した。
    // flanking 規則と後始末だけで、**記号は残らない**。どの装飾になるかは変わる。
    it('*** や **** でも記号を残さない', () => {
      expect(formatForSlack('***重要***')).toBe('_重要_')
      // 16巡目で斜体に「両端が別のアスタリスクに接していないこと」を足したので、
      // 入れ子にならず素直な太字になった。
      expect(formatForSlack('****太字****')).toBe('*太字*')
      for (const s of ['***重要***', '****太字****']) {
        expect(formatForSlack(s)).not.toContain('**')
      }
    })

    it('太字の直後に斜体が隙間なく続いても、両方とも活きる', () => {
      expect(formatForSlack('**a***b*')).toBe('*a*_b_')
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

// 独立検査を7巡かけても出なかった欠陥（見出しの中に太字があると内部の目印が漏れる）を、
// この不変条件テストは1秒未満で見つけた。**個別のケースを足し続けるのをやめ、
// 「どんな入力でも成り立つべきこと」を決めて組み合わせで殴る。**
// 検査官は与えた基準の中でしか探さない。基準に無い組み合わせはここで拾う。
describe('不変条件（部品の組み合わせを総当たりする）', () => {
  // 実際の LLM 出力に現れる部品。増やすと自動で組み合わせが増える
  const PARTS = [
    '', ' ', '\n', '\n\n',
    '二次方程式を解こう', 'ポイント', 'x', 'abc', '123', '答え',
    '**', '*', '***', '****', '_', '__', '#', '## ', '### ', '- ', '~~', '`', '```', '$', '$$',
    '\\frac{1}{2}', '\\times', '\\leq', 'x^2', 'x_1', 'ax_1', 'user_name', '__init__',
    ' ** ', ' * ', '---', '***\n', '|---|---|', '> 引用', '1. 番号',
    // 変換後に現れる素の記号。これが部品に無かったため、`*×*` の欠陥を
    // 40,000通り回しても生成できなかった（13巡目・検査官の指摘）。
    '×', '≤', '→', '±', 'θ', '²', '₁', '^^', '(', ')',
    // 数学記号を使う顔文字。13巡目の修正がこのクラスを壊したが、部品に無かったため
    // 生成できず検出できなかった（14巡目・検査官の指摘）。
    '(*≧▽≦*)', '(*^^*)', '≧', '▽', '≦', '￣', '∇', '=',
    // 顔文字によく使われるが「語」と判定される文字。これが部品に無かったため
    // 15巡目の P0 を生成できなかった。
    '(*´ω`*)', 'ω', 'д', 'ﾟ', '①', '´',
    // 顔文字が太字に隣接する形。16巡目の P0 はこの並びで起きた。
    '**(*^^*)**', '(x*y)',
  ]
  const NUL = String.fromCharCode(0)
  const count = (s: string, c: string) => s.split(c).length - 1

  /**
   * 生成した入力をすべて流し、条件を満たさない最初の1件を返す。
   *
   * ⚠️ **部品の数が足りないと、原理的に作れない形が生まれる。**
   * 当初は4部品の結合だったが、`*` + `__` + 語 + `__` + `*` のように
   * **5〜7個の境界を要する壊れ方**（11巡目の P0/P1）は4部品では生成できず、
   * 19,200通り回しても構造的に検出できなかった（独立検査 11巡目・所見）。
   * 部品数を増やすと組み合わせは急に増えるので、決め打ちの少数ループではなく
   * 疑似乱数で満遍なく引く（seed 固定なので毎回同じ入力・落ちたら再現できる）。
   */
  function findCounterexample(holds: (input: string, output: string) => boolean) {
    // xorshift。seed 固定で毎回同じ列を出す（テストが実行ごとに変わらないため）
    let seed = 0x2545f491
    const next = () => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) % PARTS.length
    }
    for (let i = 0; i < 40000; i += 1) {
      const len = 2 + (i % 6) // 2〜7部品
      let input = ''
      for (let k = 0; k < len; k += 1) input += PARTS[next()]
      const output = formatForSlack(input)
      if (!holds(input, output)) return { input, output }
    }
    return null
  }

  it('内部の目印を出力に漏らさない', () => {
    expect(findCounterexample((_i, o) => !o.includes(NUL))).toBeNull()
  })

  it('入力に無い "undefined" を作らない', () => {
    expect(
      findCounterexample((i, o) => !o.includes('undefined') || i.includes('undefined')),
    ).toBeNull()
  })

  it('< > & を新たに生成しない（escapeSlackText との整合・C-3）', () => {
    expect(
      findCounterexample((i, o) => ['<', '>', '&'].every((ch) => count(o, ch) <= count(i, ch))),
    ).toBeNull()
  })

  // 12巡目の検査官の提案。4つの不変条件はどれも「記号が残っていないか」「数式が
  // 保たれているか」を見ておらず、生成器が欠陥誘発パターンを大量に作っていても
  // 素通りしていた。**不変条件は、要件そのものを言い換えたものにする。**
  //
  // ⚠️ 適用範囲を正直に書く。コード（バッククォート）と LaTeX（`\` `^` `_`）を含む入力は
  //    除く。**この関数が正しく振る舞わないからではなく、テスト側でその範囲を
  //    再現しようとすると本体と同じ判定を2度書くことになる**ため。
  //    そこは個別のケーステストで押さえてある。
  it('生の Markdown 記号を出力に残さない（要件①）', () => {
    expect(
      findCounterexample((i, o) => {
        if (i.includes('`')) return true
        const body = o
          // べき乗として残すと決めた `**`（英数字に挟まれた形・空白つきの形）は除く
          .replace(/(?<=[A-Za-z0-9０-９])\*{2}(?=[A-Za-z0-9０-９])/g, '')
          .replace(/(?<=[A-Za-z0-9０-９][ \t])\*{2}(?=[ \t][A-Za-z0-9０-９])/g, '')
        return !body.includes('**') && !body.includes('~~')
      }),
    ).toBeNull()
  })

  it('英数字に挟まれたべき乗を消さない（無音の内容破壊を防ぐ・要件②）', () => {
    // `2**10 は 1024 です` が `210 は 1024 です` になり、**事実と違う数式**を
    // 生徒に出していた。記号も残らずエラーも出ない、完全に無音の破壊だった。
    const pairs = (t: string) => t.match(/[A-Za-z0-9０-９]\*{2}[A-Za-z0-9０-９]/g) ?? []
    expect(
      findCounterexample((i, o) => {
        if (/[`\\^_]/.test(i)) return true
        return pairs(i).every((seq) => o.includes(seq))
      }),
    ).toBeNull()
  })

  // 17巡目の検査官の指摘。6回連続で壊れてきた「顔文字」という軸を保証する不変条件が
  // 1つも無く、40,000通りの生成器はこの破壊を1件も検出できなかった。
  // **壊れた歴史のある軸には、その軸を名指しした不変条件を置く。**
  it('顔文字を原形のまま残す（6回壊れた軸）', () => {
    const faces = (t: string) => t.match(/[(（]\*[^*\n]+\*[)）]/g) ?? []
    expect(
      findCounterexample((i, o) => {
        if (i.includes('`')) return true
        return faces(i).every((face) => o.includes(face))
      }),
    ).toBeNull()
  })

  it('入力に無い日本語の文字を作らない', () => {
    expect(
      findCounterexample((i, o) =>
        [...o].every((ch) => !/[ぁ-んァ-ヶ一-鿿]/.test(ch) || i.includes(ch)),
      ),
    ).toBeNull()
  })
})
