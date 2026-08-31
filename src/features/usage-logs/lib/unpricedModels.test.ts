/** @file
 * 検証: 単価未登録モデルの検出（コスト 0 円表示の原因を管理画面に出すための判定）
 * @verifies FR-18, E-3
 */
import { describe, it, expect } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'
import { findUnpricedModels, getUnpricedModels } from './unpricedModels'

describe('findUnpricedModels', () => {
  it('MODEL_PRICING に単価があるモデルは返さない', () => {
    expect(findUnpricedModels(['claude-haiku-4-5', 'gpt-4o-mini'])).toEqual([])
  })

  it('未登録のモデルだけを返す', () => {
    expect(findUnpricedModels(['claude-haiku-4-5', 'my-local-model'])).toEqual(['my-local-model'])
  })

  it('provider/model 形式はサフィックス照合で価格が引ければ未登録扱いしない（E-3）', () => {
    expect(findUnpricedModels(['someproxy/gpt-4o-mini'])).toEqual([])
  })

  it('重複を排除し昇順に並べる（画面にそのまま出せる形）', () => {
    expect(findUnpricedModels(['zeta-1', 'alpha-1', 'zeta-1'])).toEqual(['alpha-1', 'zeta-1'])
  })

  it('null / 空文字は無視する', () => {
    expect(findUnpricedModels([null, undefined, ''])).toEqual([])
  })
})

describe('getUnpricedModels', () => {
  it('admin_used_models の結果を単価判定して返す（期間で絞らない）', async () => {
    const db = createMockDb({
      rpc: { admin_used_models: { data: ['gpt-4o', 'mystery-model'], error: null } },
    })
    await expect(getUnpricedModels(db)).resolves.toEqual(['mystery-model'])
    expect(db.__calls.rpc).toEqual([['admin_used_models', undefined]])
  })

  it('利用実績が無ければ空配列', async () => {
    const db = createMockDb({ rpc: { admin_used_models: { data: null, error: null } } })
    await expect(getUnpricedModels(db)).resolves.toEqual([])
  })

  it('RPC 失敗は文脈付きで throw する（黙って「未登録なし」にしない）', async () => {
    const db = createMockDb({
      rpc: { admin_used_models: { data: null, error: { message: 'boom' } } },
    })
    await expect(getUnpricedModels(db)).rejects.toThrow(/getUnpricedModels/)
  })
})
