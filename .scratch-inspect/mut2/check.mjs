import assert from 'node:assert/strict'
const { buildPrompt } = await import('./buildPrompt.ts')

const base = { question: '二次方程式の解き方は？', profileText: null, history: [] }
let failed = false
for (const mode of ['direct', 'socratic', 'confirmation']) {
  const { system } = buildPrompt({ ...base, mode })
  try {
    assert.ok(system.includes('見出し記法'))
    assert.ok(system.includes('二重アスタリスク'))
    assert.ok(system.includes('LaTeX'))
  } catch (e) {
    failed = true
    console.log('mode=' + mode, 'FAIL:', e.message.split('\n')[0])
  }
}
console.log(failed ? 'ミューテーションはテストで検知された（意図通り）' : 'ミューテーションが検知されない＝空のテスト')
