import { formatForSlack } from '../src/shared/lib/slack/formatForSlack.ts'
function show(label, input) {
  console.log('=== ' + label + ' ===')
  console.log(JSON.stringify(input))
  console.log('-->')
  console.log(JSON.stringify(formatForSlack(input)))
  console.log()
}
show('python dunder __init__ bare', 'Pythonの`__init__`ではなく __init__ メソッドについて説明するね')
show('python dunder __name__ bare', '__name__ が "__main__" のとき')
show('double underscore both sides generic word', '__TODO__ を消してね')
show('trailing bare double asterisk (truncation)', 'これはとても大事な話で**')
show('bare ** exactly (no trailing content at all)', '**')
