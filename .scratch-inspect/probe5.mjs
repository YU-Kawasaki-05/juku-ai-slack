import { formatForSlack } from '../src/shared/lib/slack/formatForSlack.ts'
const TRUNCATED_ANSWER_NOTICE =
  '\n\n（文字数の上限で途中までになっちゃった。「続きを教えて」と送ってくれたら続きを説明するよ）'

function show(label, input) {
  console.log('=== ' + label + ' ===')
  console.log('IN :', JSON.stringify(input))
  const out = formatForSlack(input)
  console.log('OUT:', JSON.stringify(out))
  console.log('残存**あり?', out.includes('**'))
  console.log()
}

// 出力トークン上限でちょうど "**" の直後に切れた、という現実的なシナリオ
show('truncated right after opening **', 'ここまでの説明が終わって、次に大事なのは**' + TRUNCATED_ANSWER_NOTICE)

// 見出しの後、太字が開いた直後で切れる
show('heading then truncated bold opener', '## まとめ\n重要なのは**' + TRUNCATED_ANSWER_NOTICE)
