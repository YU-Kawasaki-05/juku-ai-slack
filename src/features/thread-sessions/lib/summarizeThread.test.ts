/** @file
 * 検証: スレッド要約のトリガー計画（単調・drift耐性）・プロンプト構築・要約実行
 * @verifies AC-20-01, AC-20-02, BR-20-01, BR-20-03
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@features/slack-messages', () => ({
  countThreadMessages: vi.fn(),
  loadMessageRange: vi.fn(),
}))

import { planSummary, buildSummaryPrompt, summarizeThread } from './summarizeThread'
import { countThreadMessages, loadMessageRange } from '@features/slack-messages'
import type { LlmClient, LlmMessage } from '@features/ai-answer'
import type { ServerDb } from '@shared/types/db'

describe('planSummary（単調・欠落なし・drift耐性）', () => {
  it('未要約しっぽが20件未満なら要約しない', () => {
    expect(planSummary(0, 0)).toBeNull()
    expect(planSummary(19, 0)).toBeNull()
    expect(planSummary(29, 10)).toBeNull() // tail=19
  })

  it('しっぽ20件到達で「直近10件を除いた古い分」を要約対象にする', () => {
    expect(planSummary(20, 0)).toEqual({ offset: 0, limit: 10, newCount: 10 })
    expect(planSummary(30, 10)).toEqual({ offset: 10, limit: 10, newCount: 20 })
    expect(planSummary(40, 20)).toEqual({ offset: 20, limit: 10, newCount: 30 })
  })

  it('件数が奇数にドリフトしても発火し、要約済みは単調に追いつく（恒久停止しない）', () => {
    // 部分保存失敗などで total が奇数化しても >= 判定で発火する
    expect(planSummary(21, 0)).toEqual({ offset: 0, limit: 11, newCount: 11 })
    expect(planSummary(31, 11)).toEqual({ offset: 11, limit: 10, newCount: 21 })
  })

  it('直近KEEPより先に新規がなければ要約しない（newCount <= summarizedCount）', () => {
    // total=25, summarized=20 → tail=5<20
    expect(planSummary(25, 20)).toBeNull()
  })
})

describe('buildSummaryPrompt', () => {
  const msgs: LlmMessage[] = [
    { role: 'user', content: '二次関数がわからない' },
    { role: 'assistant', content: '一緒に整理しよう' },
  ]

  it('既存要約が無ければ「次の会話を要約」形式', () => {
    const { system, messages } = buildSummaryPrompt(null, msgs)
    expect(system).toContain('要約')
    expect(system).toContain('内部情報') // 内部情報ガード（buildPrompt と方針を揃える）
    const text = messages[0].content as string
    expect(text).toContain('次の会話を要約')
    expect(text).toContain('生徒: 二次関数がわからない')
    expect(text).not.toContain('これまでの会話の要約')
  })

  it('既存要約があれば統合を指示する（累積更新, AC-20-02）', () => {
    const { messages } = buildSummaryPrompt('前半は一次関数を学んだ', msgs)
    const text = messages[0].content as string
    expect(text).toContain('これまでの会話の要約')
    expect(text).toContain('前半は一次関数を学んだ')
    expect(text).toContain('統合')
  })

  it('画像を含む発言はプレースホルダに置換する', () => {
    const withImage: LlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'これ' }, { type: 'image', dataUrl: 'x' }] },
    ]
    const { messages } = buildSummaryPrompt(null, withImage)
    expect(messages[0].content as string).toContain('[画像を含む発言]')
  })
})

describe('summarizeThread', () => {
  const llm: LlmClient = {
    generate: vi.fn().mockResolvedValue({
      text: '要約: 二次関数の平方完成を練習した',
      usage: { inputTokens: 120, outputTokens: 60 },
      model: 'test-model',
    }),
  }

  /** update().eq().eq().eq() を await できる最小 fake。update ペイロードと eq 条件を記録 */
  function fakeDb(updateError: unknown = null) {
    const calls = { update: [] as unknown[], eq: [] as [string, unknown][] }
    const chain: Record<string, unknown> = {}
    chain.update = (v: unknown) => {
      calls.update.push(v)
      return chain
    }
    chain.eq = (col: string, val: unknown) => {
      calls.eq.push([col, val])
      return chain
    }
    chain.then = (onF: (r: { error: unknown }) => unknown) => onF({ error: updateError })
    return { db: { from: () => chain } as unknown as ServerDb, calls }
  }

  const base = {
    channelId: 'C1',
    threadTs: '100.1',
    personId: 'p1',
    model: 'test-model',
    existingSummary: null as string | null,
    summarizedCount: 0,
  }

  beforeEach(() => vi.clearAllMocks())

  it('しっぽが閾値未満なら要約せず LLM も DB 更新も呼ばない', async () => {
    vi.mocked(countThreadMessages).mockResolvedValue(18)
    const { db, calls } = fakeDb()
    const r = await summarizeThread(db, llm, base)
    expect(r.summarized).toBe(false)
    expect(llm.generate).not.toHaveBeenCalled()
    expect(calls.update).toHaveLength(0)
  })

  it('20件到達で要約し thread_summary と summary_message_count を更新、person_id で絞る', async () => {
    vi.mocked(countThreadMessages).mockResolvedValue(20)
    vi.mocked(loadMessageRange).mockResolvedValue([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
    ])
    const { db, calls } = fakeDb()
    const r = await summarizeThread(db, llm, base)
    expect(r).toEqual({
      summarized: true,
      usage: { inputTokens: 120, outputTokens: 60 },
      newCount: 10,
    })
    expect(loadMessageRange).toHaveBeenCalledWith(db, 'C1', '100.1', 'p1', 0, 10)
    expect(calls.update[0]).toEqual({
      thread_summary: '要約: 二次関数の平方完成を練習した',
      summary_message_count: 10,
    })
    // UPDATE が person_id 条件を含む（BR-05-11）
    expect(calls.eq).toContainEqual(['person_id', 'p1'])
  })

  it('既存要約があれば累積更新の入力に渡す（AC-20-02）', async () => {
    vi.mocked(countThreadMessages).mockResolvedValue(30)
    vi.mocked(loadMessageRange).mockResolvedValue([{ role: 'user', content: 'Q2' }])
    const { db } = fakeDb()
    await summarizeThread(db, llm, { ...base, existingSummary: '前半の要約', summarizedCount: 10 })
    // offset=summarizedCount(10), limit=10 の窓を取得
    expect(loadMessageRange).toHaveBeenCalledWith(db, 'C1', '100.1', 'p1', 10, 10)
    const genArg = vi.mocked(llm.generate).mock.calls[0][0]
    const userText = genArg.messages[0].content as string
    expect(userText).toContain('前半の要約')
  })

  it('対象ウィンドウが空なら要約しない', async () => {
    vi.mocked(countThreadMessages).mockResolvedValue(20)
    vi.mocked(loadMessageRange).mockResolvedValue([])
    const { db, calls } = fakeDb()
    const r = await summarizeThread(db, llm, base)
    expect(r.summarized).toBe(false)
    expect(llm.generate).not.toHaveBeenCalled()
    expect(calls.update).toHaveLength(0)
  })

  it('DB 更新エラーは throw する（呼び出し側が握りつぶす前提）', async () => {
    vi.mocked(countThreadMessages).mockResolvedValue(20)
    vi.mocked(loadMessageRange).mockResolvedValue([{ role: 'user', content: 'Q1' }])
    const { db } = fakeDb({ message: 'update failed' })
    await expect(summarizeThread(db, llm, base)).rejects.toBeDefined()
  })
})
