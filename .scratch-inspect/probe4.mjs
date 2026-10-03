import { formatForSlack } from '../src/shared/lib/slack/formatForSlack.ts'

function timeit(label, input) {
  const t0 = Date.now()
  const out = formatForSlack(input)
  const t1 = Date.now()
  console.log(label, 'len=', input.length, 'ms=', t1 - t0, 'outLen=', out.length)
}

// ReDoS 疑い: 未閉鎖の ** が大量の改行を含むテキストの末尾にある場合
const bigNoClose = '**' + 'あ\n'.repeat(100000)
timeit('unclosed bold, 100k lines, no closer', bigNoClose)

const bigNoCloseUnderscore = '__' + ('a'.repeat(50) + '\n').repeat(50000)
timeit('unclosed __ underline, 50k lines', bigNoCloseUnderscore)

// 大量の * を含む一般テキスト（斜体マッチの再帰的探索を誘発しないか）
const manyStars = '*'.repeat(50000)
timeit('50k consecutive asterisks alone', manyStars)

const manyStarsWithWords = ('*a* '.repeat(20000))
timeit('20k * a * pattern repeated', manyStarsWithWords)

// 大量の改行入り太字が閉じないケースで空行を含む場合（段落またぎ判定の再帰）
const noCloseWithParagraphs = ('**段落\n\nつぎ\n\n').repeat(20000)
timeit('unclosed bold across many paragraphs', noCloseWithParagraphs)
