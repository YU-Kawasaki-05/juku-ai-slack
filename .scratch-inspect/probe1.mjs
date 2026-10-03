import { formatForSlack, convertMarkdownToMrkdwn, convertMath } from '../src/shared/lib/slack/formatForSlack.ts'

function show(label, input) {
  console.log('=== ' + label + ' ===')
  console.log(JSON.stringify(input))
  console.log('-->')
  console.log(JSON.stringify(formatForSlack(input)))
  console.log()
}

show('table separator row', '| 見出し1 | 見出し2 |\n| --- | --- |\n| a | b |')
show('table separator no leading pipe', '見出し\n---|---\na|b')
show('bullet then rule-like content', '- --')
show('list where item text is just dash', '- 一つ目\n--\n- 二つ目')
show('multiply expr line alone', '3 * 4 * 5')
show('spaced rule with more dashes', '- - - -')
show('spaced rule asterisks', '* * *')
show('bare double asterisk line', '説明\n\n**\n\n続き')
show('emphasis run 5 asterisks alone', '*****')
