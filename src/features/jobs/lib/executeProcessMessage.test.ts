/** @file
 * 検証: AI回答フローのオーケストレーション（プロフィール/履歴取得→モード→生成→返信→保存→記録）
 * @verifies FR-05, AC-05-01, AC-05-09
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrCreateSession: vi.fn(),
  getStudentProfile: vi.fn(),
  getMastery: vi.fn(),
  getKnowledgeSummary: vi.fn(),
  evaluate: vi.fn(),
  applyEvaluation: vi.fn(),
  loadThreadHistory: vi.fn(),
  saveMessage: vi.fn(),
  logUsage: vi.fn(),
  logError: vi.fn(),
  postMessage: vi.fn(),
  generate: vi.fn(),
  searchChunks: vi.fn(),
  getEmbeddingClient: vi.fn(),
}))

vi.mock('@features/thread-sessions', () => ({ getOrCreateSession: mocks.getOrCreateSession }))
vi.mock('@features/student-profiles', () => ({ getStudentProfile: mocks.getStudentProfile }))
vi.mock('@features/student-knowledge', () => ({
  getMastery: mocks.getMastery,
  getKnowledgeSummary: mocks.getKnowledgeSummary,
  evaluate: mocks.evaluate,
  applyEvaluation: mocks.applyEvaluation,
}))
vi.mock('@features/slack-messages', () => ({
  loadThreadHistory: mocks.loadThreadHistory,
  saveMessage: mocks.saveMessage,
}))
vi.mock('@features/usage-logs', () => ({ logUsage: mocks.logUsage }))
vi.mock('@features/error-logs', () => ({ logError: mocks.logError }))
vi.mock('@features/rag', () => ({
  searchChunks: mocks.searchChunks,
  getEmbeddingClient: mocks.getEmbeddingClient,
}))
vi.mock('@shared/lib/slack/client', () => ({ postMessage: mocks.postMessage }))

import { executeProcessSlackMessage } from './executeProcessMessage'
import { __setLlmClientForTest } from '@features/ai-answer'
import type { ProcessSlackMessagePayload } from '../types'

const payload: ProcessSlackMessagePayload = {
  teamId: 'T1',
  channelId: 'C1',
  messageTs: '100.1',
  threadTs: '100.1',
  userId: 'U1',
  text: '<@U_BOT> 二次方程式がわからない',
  personId: '00000000-0000-0000-0000-000000000001',
  reportId: null,
  eventId: 'Ev1',
}

const db = {} as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getOrCreateSession.mockResolvedValue({ id: 's1' })
  mocks.getStudentProfile.mockResolvedValue({ profileText: null, examMode: false })
  mocks.getMastery.mockResolvedValue(0.2)
  mocks.getKnowledgeSummary.mockResolvedValue(null)
  mocks.loadThreadHistory.mockResolvedValue([])
  mocks.saveMessage.mockResolvedValue(undefined)
  mocks.logUsage.mockResolvedValue(undefined)
  mocks.logError.mockResolvedValue(undefined)
  mocks.evaluate.mockResolvedValue({
    evaluation: { signal: 'correct', topic_id: '二次方程式', subject: '数学', confidence: 0.9, reasoning: 'r', identified_misconception: null },
    result: { text: '{}', usage: { inputTokens: 10, outputTokens: 5 }, model: 'test-default-model' },
  })
  mocks.applyEvaluation.mockResolvedValue({ updated: true, newPMastery: 0.5 })
  mocks.searchChunks.mockResolvedValue([])
  mocks.getEmbeddingClient.mockReturnValue({ embed: vi.fn() })
  mocks.postMessage.mockResolvedValue({ ts: '200.2' })
  mocks.generate.mockResolvedValue({
    text: '一緒に整理しよう',
    usage: { inputTokens: 100, outputTokens: 40 },
    model: 'test-default-model',
  })
  __setLlmClientForTest({ generate: mocks.generate })
})

describe('executeProcessSlackMessage', () => {
  it('メンション除去した質問で AI 応答を生成し Slack に返信する（AC-05-01）', async () => {
    await executeProcessSlackMessage(db, payload)

    // メンション記法が除去されている
    const genArg = mocks.generate.mock.calls[0][0]
    expect(genArg.messages.at(-1).content).toBe('二次方程式がわからない')
    expect(genArg.model).toBe('test-default-model')

    // AI 応答が Slack にスレッド返信される
    expect(mocks.postMessage).toHaveBeenCalledWith({
      channel: 'C1',
      text: '一緒に整理しよう',
      threadTs: '100.1',
    })
  })

  it('P=0.2 かつ試験前でない → direct モード（system に direct 指示）', async () => {
    await executeProcessSlackMessage(db, payload)
    expect(mocks.generate.mock.calls[0][0].system).toContain('direct')
  })

  it('会話履歴を user/assistant で保存し、利用量を記録する（FR-12）', async () => {
    await executeProcessSlackMessage(db, payload)
    expect(mocks.saveMessage).toHaveBeenCalledTimes(2)
    const roles = mocks.saveMessage.mock.calls.map((c) => c[1].role)
    expect(roles).toEqual(['user', 'assistant'])

    expect(mocks.logUsage).toHaveBeenCalledOnce()
    const usageArg = mocks.logUsage.mock.calls[0][1]
    expect(usageArg.model).toBe('test-default-model')
    expect(usageArg.usage).toEqual({ inputTokens: 100, outputTokens: 40 })
    expect(usageArg.personId).toBe(payload.personId)
  })

  it('試験前モードなら P 値によらず direct', async () => {
    mocks.getStudentProfile.mockResolvedValue({ profileText: null, examMode: true })
    mocks.getMastery.mockResolvedValue(0.9) // 通常なら confirmation
    await executeProcessSlackMessage(db, payload)
    expect(mocks.generate.mock.calls[0][0].system).toContain('direct')
  })

  it('履歴取得は person_id でも絞る（BR-05-11）', async () => {
    await executeProcessSlackMessage(db, payload)
    expect(mocks.loadThreadHistory).toHaveBeenCalledWith(
      db,
      'C1',
      '100.1',
      payload.personId,
    )
  })

  it('質問が長すぎる場合は LLM を呼ばず TokenBudgetExceededError（コスト暴走防止）', async () => {
    const long = { ...payload, text: `<@U_BOT> ${'あ'.repeat(7000)}` }
    await expect(executeProcessSlackMessage(db, long)).rejects.toMatchObject({
      code: 'TOKEN_BUDGET_EXCEEDED',
    })
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.postMessage).not.toHaveBeenCalled()
  })

  it('返信後の保存失敗はベストエフォート（throw せず＝再返信を招かない）', async () => {
    mocks.saveMessage.mockRejectedValue(new Error('db blip'))
    await expect(executeProcessSlackMessage(db, payload)).resolves.toBeUndefined()
    expect(mocks.postMessage).toHaveBeenCalledOnce()
  })

  it('履歴に直前の確認質問があれば Evaluator を実行し BKT を更新（FR-23）', async () => {
    mocks.loadThreadHistory.mockResolvedValue([
      { role: 'user', content: '前の質問' },
      { role: 'assistant', content: '判別式ってどういう意味？' },
    ])
    await executeProcessSlackMessage(db, payload)
    expect(mocks.evaluate).toHaveBeenCalledOnce()
    // 直前の assistant（確認質問）と生徒返信を渡す
    expect(mocks.evaluate.mock.calls[0][1]).toEqual({
      botQuestion: '判別式ってどういう意味？',
      studentReply: '二次方程式がわからない',
    })
    expect(mocks.applyEvaluation).toHaveBeenCalledOnce()
  })

  it('直前の確認質問が無ければ Evaluator を呼ばない（初回ターン）', async () => {
    mocks.loadThreadHistory.mockResolvedValue([])
    await executeProcessSlackMessage(db, payload)
    expect(mocks.evaluate).not.toHaveBeenCalled()
  })

  it('Evaluator 失敗は回答を妨げない（サイレント、logError 記録）（BR-23-06）', async () => {
    mocks.loadThreadHistory.mockResolvedValue([{ role: 'assistant', content: 'Q?' }])
    mocks.evaluate.mockRejectedValue(new Error('eval boom'))
    await expect(executeProcessSlackMessage(db, payload)).resolves.toBeUndefined()
    expect(mocks.postMessage).toHaveBeenCalledOnce() // 回答は送信済み
    expect(mocks.logError).toHaveBeenCalled()
  })

  it('低確信度は LOW_CONFIDENCE_SKIP を記録（AC-23-07）', async () => {
    mocks.loadThreadHistory.mockResolvedValue([{ role: 'assistant', content: 'Q?' }])
    mocks.applyEvaluation.mockResolvedValue({ updated: false, reason: 'low_confidence' })
    await executeProcessSlackMessage(db, payload)
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'LOW_CONFIDENCE_SKIP', severity: 'info' }),
    )
  })

  it('知識状態サマリーをプロンプトに注入する（AC-23-05）', async () => {
    mocks.getKnowledgeSummary.mockResolvedValue('数学: 二次方程式(苦手:P=0.18,2回)')
    await executeProcessSlackMessage(db, payload)
    expect(mocks.generate.mock.calls[0][0].system).toContain('二次方程式(苦手')
  })

  it('RAG チャンクをプロンプトに渡す（FR-10）', async () => {
    mocks.searchChunks.mockResolvedValue([{ content: '今月は二次方程式で計算ミスが多い' }])
    await executeProcessSlackMessage(db, payload)
    expect(mocks.generate.mock.calls[0][0].system).toContain('計算ミスが多い')
  })

  it('RAG 検索失敗はチャンクなしで継続し REPORT_CHUNK_SEARCH_FAILED を記録', async () => {
    mocks.searchChunks.mockRejectedValue(new Error('rag boom'))
    await expect(executeProcessSlackMessage(db, payload)).resolves.toBeUndefined()
    expect(mocks.postMessage).toHaveBeenCalledOnce()
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'REPORT_CHUNK_SEARCH_FAILED' }),
    )
  })
})
