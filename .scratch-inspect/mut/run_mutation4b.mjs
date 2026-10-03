import assert from 'node:assert/strict'
const m = await import('./mut4_ascii_mark.ts')

// 実際のテスト「無関係なコードブロックの中身にすり替わらない」を再現
const result = m.formatForSlack('@@SFPH@@CODE0@@SFPH@@ **本当は太字** `本当はコード`')
console.log('result =', JSON.stringify(result))
try {
  assert.ok(result.includes('@@SFPH@@CODE0@@SFPH@@'), 'forged marker should remain literally')
  assert.ok(result.includes('*本当は太字*'))
  assert.ok(result.includes('`本当はコード`'))
  console.log('PASS: このミューテーションはこのテストでは検知されない')
} catch (e) {
  console.log('FAIL(検知された):', e.message)
}
