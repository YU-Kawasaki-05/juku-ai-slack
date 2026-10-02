import { formatForSlack } from '../src/shared/lib/slack/formatForSlack.ts'
function show(label, input) {
  console.log('=== ' + label + ' ===')
  console.log(JSON.stringify(input))
  console.log('-->')
  console.log(JSON.stringify(formatForSlack(input)))
  console.log()
}

// CRLF fences
show('CRLF fence', '```\r\nx = **1**\r\n```\r\n**太字**')

// 末尾改行なしのフェンス
show('no trailing newline after closing fence', '```\nx = **1**\n```')
show('no trailing newline, content after on same logical text', '前置き\n```\nx = **1**\n```\n後置き**太字**')

// インデントされたフェンス（3スペースまでOK、4スペースはコードブロックとしてMarkdown上は別解釈だが、ここでの実装は？）
show('indented fence 2 spaces', '  ```\n  x = **1**\n  ```\n**太字**')
show('indented fence 4 spaces (should NOT be treated as fence per CommonMark, becomes indented code)', '    ```\n    x = **1**\n    ```\n**太字**')

// 連続する複数フェンス
show('multiple consecutive fences', '```\nA**1**\n```\n**外太字**\n```\nB**2**\n```')

// 言語指定つきクローズ誤認（既存テストにあるが再確認）
show('closing fence with language tag should not be treated as closer', ['```', 'a = 1', '```js これは閉じてない', 'b = 2 **not bold**', '```'].join('\n'))
