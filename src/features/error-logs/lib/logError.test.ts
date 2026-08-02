/** @file
 * 検証: ai_error_logs への記録と、設定不備向けのログ洪水抑止（dedupeWhileUnresolved）
 * @verifies FR-11, B-8
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'
import { logError } from './logError'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logError', () => {
  it('通常は重複判定せずそのまま insert する', async () => {
    const db = createMockDb({ thenable: { error: null } })
    await logError(db, { code: 'AI_TIMEOUT', severity: 'error', internalMessage: 'timed out' })

    expect(db.__builder.maybeSingle).not.toHaveBeenCalled()
    expect(db.__calls.insert).toHaveLength(1)
    expect(db.__calls.insert[0]).toMatchObject({
      error_code: 'AI_TIMEOUT',
      severity: 'error',
      internal_message: 'timed out',
    })
  })

  it('raw_error は許可キーのみ抽出する（鍵の混入防止）', async () => {
    const db = createMockDb({ thenable: { error: null } })
    await logError(db, {
      code: 'AI_RESPONSE_FAILED',
      severity: 'error',
      rawError: { name: 'E', status: 500, headers: { Authorization: 'Bearer secret' } },
    })
    expect(db.__calls.insert[0]).toMatchObject({ raw_error: { name: 'E', status: 500 } })
    expect(JSON.stringify(db.__calls.insert[0])).not.toContain('secret')
  })

  it('記録自体が失敗しても throw しない（主処理を止めない）', async () => {
    const db = createMockDb({ thenable: { error: { message: 'boom' } } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      logError(db, { code: 'AI_TIMEOUT', severity: 'error' }),
    ).resolves.toBeUndefined()
  })

  // --- dedupeWhileUnresolved: 設定不備のように「直すまで毎回起きる」事象のログ洪水を防ぐ ---
  it('dedupeWhileUnresolved: 未解決の同一 code があれば記録しない', async () => {
    const db = createMockDb({
      maybeSingle: { data: { id: 'existing' }, error: null },
      thenable: { error: null },
    })
    await logError(db, {
      code: 'IMAGE_MODEL_NOT_CONFIGURED',
      severity: 'warning',
      dedupeWhileUnresolved: true,
    })

    expect(db.__calls.insert).toHaveLength(0)
    // 判定は error_code + resolved=false で行う
    expect(db.__calls.eq).toEqual([
      ['error_code', 'IMAGE_MODEL_NOT_CONFIGURED'],
      ['resolved', false],
    ])
  })

  it('dedupeWhileUnresolved: 未解決が無ければ記録する（解決済みにした後の再発は拾える）', async () => {
    const db = createMockDb({
      maybeSingle: { data: null, error: null },
      thenable: { error: null },
    })
    await logError(db, {
      code: 'IMAGE_MODEL_NOT_CONFIGURED',
      severity: 'warning',
      dedupeWhileUnresolved: true,
    })

    expect(db.__calls.insert).toHaveLength(1)
    expect(db.__calls.insert[0]).toMatchObject({ error_code: 'IMAGE_MODEL_NOT_CONFIGURED' })
  })

  it('dedupeWhileUnresolved: 判定クエリが失敗したら記録する側に倒す（見落とし防止）', async () => {
    const db = createMockDb({
      maybeSingle: { data: null, error: { message: 'select failed' } },
      thenable: { error: null },
    })
    await logError(db, {
      code: 'IMAGE_MODEL_NOT_CONFIGURED',
      severity: 'warning',
      dedupeWhileUnresolved: true,
    })

    expect(db.__calls.insert).toHaveLength(1)
  })
})
