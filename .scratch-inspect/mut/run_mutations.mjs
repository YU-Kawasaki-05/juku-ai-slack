import assert from 'node:assert/strict'

async function testMutation(label, path, checks) {
  const mod = await import(path)
  let failures = []
  for (const [desc, fn] of checks) {
    try {
      fn(mod)
    } catch (e) {
      failures.push(desc + ' :: ' + e.message)
    }
  }
  console.log('=== ' + label + ' ===')
  if (failures.length === 0) {
    console.log('  全チェックPASS → このミューテーションは既存テストで検知されない可能性（要確認）')
  } else {
    console.log('  ' + failures.length + '件のチェックが失敗（=ミューテーションをテストが検知した）')
    for (const f of failures) console.log('   - ' + f)
  }
  console.log()
}

// Mutation 1: 水平線regex無効化 → 3巡目の回帰テスト群が落ちるべき
await testMutation('Mutation1: 水平線regexを無効化', './mut1_no_hr.ts', [
  ["formatForSlack('---') === '──────────'", (m) => assert.equal(m.formatForSlack('---'), '──────────')],
  ["formatForSlack('***') not contain **", (m) => assert.ok(!m.formatForSlack('***').includes('**'))],
  ["'上の説明\\n\\n***\\n\\n下の説明' 変換", (m) => assert.equal(m.formatForSlack('上の説明\n\n***\n\n下の説明'), '上の説明\n\n──────────\n\n下の説明')],
])

// Mutation 2: 閉じフェンスの緩和（言語指定行を閉じと誤認するか）
await testMutation('Mutation2: 閉じフェンスを緩和（対称判定に戻す）', './mut2_loose_closing_fence.ts', [
  ["言語指定つきの行を閉じフェンスと誤認しない", (m) => {
    const input = ['```', 'a = 1', '```js これは本当は閉じてない例', 'b = 2  # **not bold**', '```'].join('\n')
    assert.equal(m.formatForSlack(input), input)
  }],
])

// Mutation 3: bare下付きに旧lookbehindを追加（ax_1 / bx_2 を取りこぼす）
await testMutation('Mutation3: bare下付きに旧lookbehind復活', './mut3_old_lookbehind_subscript.ts', [
  ["係数つきの変数の添字も変換する（ax_1 / bx_2）", (m) => assert.equal(m.formatForSlack('ax_1 + bx_2 = c'), 'ax₁ + bx₂ = c')],
  ["単純な x_1 + x_2 は従来通り変換される（回帰していないか）", (m) => assert.equal(m.formatForSlack('$x_1 + x_2$'), 'x₁ + x₂')],
])

// Mutation 4: MARKをASCIIに戻す（プレースホルダ衝突が再現するか）
await testMutation('Mutation4: MARKをASCII @@SFPH@@ に戻す', './mut4_ascii_mark.ts', [
  ["目印に似た文字列があっても本文を消さない", (m) => {
    const input = '設問の答えは @@SFPH@@CODE0@@SFPH@@ です。'
    assert.equal(m.formatForSlack(input), input)
  }],
])
