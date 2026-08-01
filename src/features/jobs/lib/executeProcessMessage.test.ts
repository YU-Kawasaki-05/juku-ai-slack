/** @file
 * 検証: AI回答フローのオーケストレーション（プロフィール/履歴取得→モード→質問保存→生成→記録→返信）
 * @verifies FR-05, AC-05-01, AC-05-09, A-3, A-4, A-8, A-9, A-12, A-15, C-3
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrCreateSession: vi.fn(),
  summarizeThread: vi.fn(),
  getStudentProfile: vi.fn(),
  getMastery: vi.fn(),
  getKnowledgeSummary: vi.fn(),
  evaluate: vi.fn(),
  applyEvaluation: vi.fn(),
  loadThreadHistory: vi.fn(),
  loadThreadTail: vi.fn(),
  loadPrecedingAssistantText: vi.fn(),
  saveMessage: vi.fn(),
  logUsage: vi.fn(),
  logError: vi.fn(),
  postMessage: vi.fn(),
  generate: vi.fn(),
  searchChunks: vi.fn(),
  getEmbeddingClient: vi.fn(),
  processAttachments: vi.fn(),
  checkQuestionRateLimit: vi.fn(),
}))

vi.mock('@features/thread-sessions', () => ({
  getOrCreateSession: mocks.getOrCreateSession,
  summarizeThread: mocks.summarizeThread,
}))
vi.mock('@features/student-profiles', () => ({ getStudentProfile: mocks.getStudentProfile }))
vi.mock('@features/student-knowledge', () => ({
  getMastery: mocks.getMastery,
  getKnowledgeSummary: mocks.getKnowledgeSummary,
  evaluate: mocks.evaluate,
  applyEvaluation: mocks.applyEvaluation,
}))
vi.mock('@features/slack-messages', () => ({
  loadThreadHistory: mocks.loadThreadHistory,
  loadThreadTail: mocks.loadThreadTail,
  loadPrecedingAssistantText: mocks.loadPrecedingAssistantText,
  saveMessage: mocks.saveMessage,
}))
vi.mock('@features/usage-logs', () => ({ logUsage: mocks.logUsage }))
vi.mock('@features/error-logs', () => ({ logError: mocks.logError }))
// EmbeddingNotConfiguredError は instanceof で判定されるため実体を渡す
vi.mock('@features/rag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/rag')>()),
  searchChunks: mocks.searchChunks,
  getEmbeddingClient: mocks.getEmbeddingClient,
}))
vi.mock('@features/image-attachments', () => ({ processAttachments: mocks.processAttachments }))
vi.mock('@features/rate-limit', () => ({ checkQuestionRateLimit: mocks.checkQuestionRateLimit }))
vi.mock('@shared/lib/slack/client', () => ({ postMessage: mocks.postMessage }))

import { executeProcessSlackMessage, TRUNCATED_ANSWER_NOTICE } from './executeProcessMessage'
import { EmbeddingNotConfiguredError } from '@features/rag'
import { getUserFacingMessage } from '@shared/lib/errors/userMessages'
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

/** 画像のみ（テキストなし）のメッセージ。添付が全滅したときの案内文言の検証に使う */
const imageOnlyPayload: ProcessSlackMessagePayload = {
  ...payload,
  text: '<@U_BOT>',
  files: [
    { id: 'F1', name: 'q.png', mimetype: 'image/png', size: 100, urlPrivate: 'https://slack/F1' },
  ],
}

/** jobs.result_text の退避（executeProcessMessage が直接 db を触る唯一の箇所）を受けられる fake */
const jobUpdates: unknown[] = []
const dbChain: Record<string, unknown> = {}
dbChain.update = (v: unknown) => {
  jobUpdates.push(v)
  return dbChain
}
dbChain.eq = () => dbChain
dbChain.then = (onF: (r: { error: unknown }) => unknown) => onF({ error: null })
const db = { from: () => dbChain } as never

beforeEach(() => {
  jobUpdates.length = 0
  vi.clearAllMocks()
  mocks.getOrCreateSession.mockResolvedValue({
    id: 's1',
    person_id: payload.personId,
    thread_summary: null,
    summary_message_count: 0,
  })
  mocks.summarizeThread.mockResolvedValue({ summarized: false })
  mocks.getStudentProfile.mockResolvedValue({ profileText: null, examMode: false })
  mocks.getMastery.mockResolvedValue(0.2)
  mocks.getKnowledgeSummary.mockResolvedValue(null)
  mocks.loadThreadHistory.mockResolvedValue([])
  mocks.loadThreadTail.mockResolvedValue([])
  mocks.loadPrecedingAssistantText.mockResolvedValue(null)
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
  mocks.processAttachments.mockResolvedValue({ dataUrls: [], errorCodes: [] })
  mocks.checkQuestionRateLimit.mockResolvedValue({ limited: false, count: 1 })
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

  // --- FR-09: 管理画面で保存したプロフィール/試験期間が実際に効くか（F-3 の書込経路の受け口） ---
  it('AC-09-02: プロフィール要約が生成プロンプトの system に載る', async () => {
    mocks.getStudentProfile.mockResolvedValue({
      profileText: '要約: 文章題でつまずきやすい\n苦手: 割合',
      examMode: false,
    })
    await executeProcessSlackMessage(db, payload)

    const system = mocks.generate.mock.calls[0][0].system
    expect(system).toContain('文章題でつまずきやすい')
    expect(system).toContain('苦手: 割合')
    // 他生徒に流用させない前置きつきで入る（BR-05-11）
    expect(system).toContain('この生徒のメモ')
    // person_id で引いている
    expect(mocks.getStudentProfile).toHaveBeenCalledWith(db, payload.personId)
  })

  it('AC-09-03: プロフィール未登録でもエラーにせず回答する（BR-09-04）', async () => {
    mocks.getStudentProfile.mockResolvedValue({ profileText: null, examMode: false })
    await expect(executeProcessSlackMessage(db, payload)).resolves.toBeUndefined()
    expect(mocks.generate.mock.calls[0][0].system).not.toContain('この生徒のメモ')
    expect(mocks.postMessage).toHaveBeenCalledOnce()
  })

  it('AC-05-05: 試験期間中は確認質問なし（direct）で Evaluator も起動しない', async () => {
    mocks.getStudentProfile.mockResolvedValue({ profileText: null, examMode: true })
    mocks.getMastery.mockResolvedValue(0.9) // 通常なら confirmation → Evaluator 起動
    mocks.loadPrecedingAssistantText.mockResolvedValue('前回の確認質問')
    await executeProcessSlackMessage(db, payload)

    const system = mocks.generate.mock.calls[0][0].system
    expect(system).toContain('direct（直接指導）')
    expect(system).not.toContain('confirmation（確認）')
    // direct には確認質問が無いので採点対象も無い（A-8）
    expect(mocks.evaluate).not.toHaveBeenCalled()
  })

  it('履歴取得は person_id でも絞り、今回の質問自身は除外する（BR-05-11 / A-4）', async () => {
    await executeProcessSlackMessage(db, payload)
    // 要約が無いスレッド（summary_message_count=0）は従来どおり loadThreadHistory（直近）を使う
    expect(mocks.loadThreadHistory).toHaveBeenCalledWith(
      db,
      'C1',
      '100.1',
      payload.personId,
      undefined,
      '100.1',
    )
  })

  it('要約済み接頭辞があるスレッドは「その後ろ」を履歴に読む（欠落なし, FR-20 / A-12）', async () => {
    mocks.getOrCreateSession.mockResolvedValue({
      id: 's1',
      person_id: payload.personId,
      thread_summary: '前半の要約',
      summary_message_count: 12,
    })
    await executeProcessSlackMessage(db, payload)
    // A-12: 上限超過時に新しい側を残す loadThreadTail 経由で取得（loadThreadHistory は使わない）
    expect(mocks.loadThreadTail).toHaveBeenCalledWith(
      db,
      'C1',
      '100.1',
      payload.personId,
      12,
      30,
      '100.1',
    )
    expect(mocks.loadThreadHistory).not.toHaveBeenCalled()
    expect(mocks.summarizeThread).toHaveBeenCalledOnce()
  })

  it('返信後にスレッド要約を試み、既存要約と要約済み件数を渡す（FR-20）', async () => {
    mocks.getOrCreateSession.mockResolvedValue({
      id: 's1',
      person_id: payload.personId,
      thread_summary: '既存',
      summary_message_count: 10,
    })
    await executeProcessSlackMessage(db, payload)
    expect(mocks.summarizeThread).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.objectContaining({
        channelId: 'C1',
        threadTs: '100.1',
        personId: payload.personId,
        existingSummary: '既存',
        summarizedCount: 10,
      }),
    )
  })

  it('要約生成時は usage を記録する（FR-12 / FR-20）', async () => {
    mocks.summarizeThread.mockResolvedValue({
      summarized: true,
      usage: { inputTokens: 200, outputTokens: 80 },
      newCount: 10,
    })
    await executeProcessSlackMessage(db, payload)
    expect(mocks.logUsage).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ messageTs: '100.1-summary' }),
    )
  })

  it('別生徒に再割当てされたスレッドでは要約を注入も生成もしない（BR-05-11）', async () => {
    mocks.getOrCreateSession.mockResolvedValue({
      id: 's1',
      person_id: 'other-person', // payload.personId と不一致
      thread_summary: '生徒Aの要約',
      summary_message_count: 20,
    })
    await executeProcessSlackMessage(db, payload)
    // 要約は使わず通常履歴にフォールバック、要約生成も呼ばない
    expect(mocks.loadThreadHistory).toHaveBeenCalledWith(
      db,
      'C1',
      '100.1',
      payload.personId,
      undefined,
      '100.1',
    )
    expect(mocks.loadThreadTail).not.toHaveBeenCalled()
    expect(mocks.summarizeThread).not.toHaveBeenCalled()
  })

  it('要約生成が失敗しても回答フローは完了する（BR-20-04）', async () => {
    mocks.summarizeThread.mockRejectedValue(new Error('summary blip'))
    await expect(executeProcessSlackMessage(db, payload)).resolves.toBeUndefined()
    expect(mocks.postMessage).toHaveBeenCalled()
  })

  it('質問が長すぎる場合は LLM を呼ばず TokenBudgetExceededError（コスト暴走防止）', async () => {
    const long = { ...payload, text: `<@U_BOT> ${'あ'.repeat(7000)}` }
    await expect(executeProcessSlackMessage(db, long)).rejects.toMatchObject({
      code: 'TOKEN_BUDGET_EXCEEDED',
    })
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.postMessage).not.toHaveBeenCalled()
  })

  // --- F-2: per-person レート制限（運用設計 3.4: 10回/時）---
  it('上限超過なら LLM を呼ばず定型文だけ返す（コスト遮断, F-2）', async () => {
    mocks.checkQuestionRateLimit.mockResolvedValue({ limited: true, count: 10 })

    await expect(executeProcessSlackMessage(db, payload)).resolves.toBeUndefined()

    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.logUsage).not.toHaveBeenCalled()
    expect(mocks.postMessage).toHaveBeenCalledWith({
      channel: 'C1',
      text: getUserFacingMessage('RATE_LIMITED'),
      threadTs: '100.1',
    })
  })

  it('上限超過の判定は person_id 単位で行う（F-2）', async () => {
    mocks.checkQuestionRateLimit.mockResolvedValue({ limited: true, count: 10 })
    await executeProcessSlackMessage(db, payload)
    expect(mocks.checkQuestionRateLimit).toHaveBeenCalledWith(db, payload.personId)
  })

  it('上限超過は RATE_LIMITED を info で記録し、質問は保存しない（F-2）', async () => {
    mocks.checkQuestionRateLimit.mockResolvedValue({ limited: true, count: 12 })

    await executeProcessSlackMessage(db, payload)

    expect(mocks.logError).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        code: 'RATE_LIMITED',
        severity: 'info',
        personId: payload.personId,
      }),
    )
    // 画像 DL・セッション確保・履歴保存といった後続コストも発生させない
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(mocks.getOrCreateSession).not.toHaveBeenCalled()
    expect(mocks.processAttachments).not.toHaveBeenCalled()
  })

  it('レート制限の判定は LLM 呼び出しより前に走る（F-2）', async () => {
    await executeProcessSlackMessage(db, payload)
    expect(mocks.checkQuestionRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generate.mock.invocationCallOrder[0],
    )
  })

  it('カウント不能（limited=false）なら通常どおり回答する（可用性優先, F-2）', async () => {
    mocks.checkQuestionRateLimit.mockResolvedValue({ limited: false, count: null })
    await executeProcessSlackMessage(db, payload)
    expect(mocks.generate).toHaveBeenCalledOnce()
  })

  it('生成済み回答の配信リトライではレート制限を評価しない（既に課金済み, F-2 / A-3）', async () => {
    mocks.checkQuestionRateLimit.mockResolvedValue({ limited: true, count: 99 })
    await executeProcessSlackMessage(db, payload, { jobId: 'job1', resultText: '生成済みの回答' })
    expect(mocks.checkQuestionRateLimit).not.toHaveBeenCalled()
    expect(mocks.postMessage.mock.calls[0][0].text).toBe('生成済みの回答')
  })

  it('返信後の保存失敗はベストエフォート（throw せず＝再返信を招かない）', async () => {
    mocks.saveMessage.mockRejectedValue(new Error('db blip'))
    await expect(executeProcessSlackMessage(db, payload)).resolves.toBeUndefined()
    expect(mocks.postMessage).toHaveBeenCalledOnce()
  })

  // --- A-8: Evaluator の起動条件 ---
  it('direct モードでは Evaluator を起動しない（確認質問が無いターン, A-8）', async () => {
    mocks.getMastery.mockResolvedValue(0.2) // → direct
    mocks.loadPrecedingAssistantText.mockResolvedValue('前回の説明')
    await executeProcessSlackMessage(db, payload)
    expect(mocks.evaluate).not.toHaveBeenCalled()
    expect(mocks.applyEvaluation).not.toHaveBeenCalled()
    // 直前 assistant の取得すら行わない（無駄なクエリを撃たない）
    expect(mocks.loadPrecedingAssistantText).not.toHaveBeenCalled()
  })

  it('confirmation モードでは Evaluator を起動し BKT を更新（FR-23 / A-8）', async () => {
    mocks.getMastery.mockResolvedValue(0.9) // → confirmation
    mocks.loadPrecedingAssistantText.mockResolvedValue('判別式ってどういう意味？')
    await executeProcessSlackMessage(db, payload)
    expect(mocks.evaluate).toHaveBeenCalledOnce()
    expect(mocks.evaluate.mock.calls[0][1]).toEqual({
      botQuestion: '判別式ってどういう意味？',
      studentReply: '二次方程式がわからない',
    })
    expect(mocks.applyEvaluation).toHaveBeenCalledOnce()
  })

  it('socratic モードでも Evaluator を起動する（A-8）', async () => {
    mocks.getMastery.mockResolvedValue(0.5) // → socratic
    mocks.loadPrecedingAssistantText.mockResolvedValue('どうなると思う？')
    await executeProcessSlackMessage(db, payload)
    expect(mocks.evaluate).toHaveBeenCalledOnce()
  })

  // --- A-9: 評価対象の取り違え防止 ---
  it('評価対象の Bot 発言は「今回の質問より前」の assistant を明示的に引く（A-9）', async () => {
    mocks.getMastery.mockResolvedValue(0.9)
    mocks.loadPrecedingAssistantText.mockResolvedValue('Q?')
    // 履歴末尾に並行ジョブが書いた「未来の回答」があっても、そちらは使わない
    mocks.loadThreadHistory.mockResolvedValue([{ role: 'assistant', content: '別ジョブの回答' }])
    await executeProcessSlackMessage(db, payload)
    expect(mocks.loadPrecedingAssistantText).toHaveBeenCalledWith(
      db,
      'C1',
      '100.1',
      payload.personId,
      '100.1',
    )
    expect(mocks.evaluate.mock.calls[0][1].botQuestion).toBe('Q?')
  })

  it('直前の確認質問が無ければ Evaluator を呼ばない（初回ターン）', async () => {
    mocks.getMastery.mockResolvedValue(0.9)
    mocks.loadPrecedingAssistantText.mockResolvedValue(null)
    await executeProcessSlackMessage(db, payload)
    expect(mocks.evaluate).not.toHaveBeenCalled()
  })

  it('Evaluator 失敗は回答を妨げず EVALUATOR_FAILED で記録（Tutor 失敗と区別する, BR-23-06）', async () => {
    mocks.getMastery.mockResolvedValue(0.9)
    mocks.loadPrecedingAssistantText.mockResolvedValue('Q?')
    mocks.evaluate.mockRejectedValue(new Error('eval boom'))
    await expect(executeProcessSlackMessage(db, payload)).resolves.toBeUndefined()
    expect(mocks.postMessage).toHaveBeenCalledOnce() // 回答は送信済み
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'EVALUATOR_FAILED', severity: 'warning' }),
    )
    // 主回答は成功しているので AI_RESPONSE_FAILED のメトリクスは汚さない
    const codes = mocks.logError.mock.calls.map((c) => c[1].code)
    expect(codes).not.toContain('AI_RESPONSE_FAILED')
  })

  it('低確信度は LOW_CONFIDENCE_SKIP を記録（AC-23-07）', async () => {
    mocks.getMastery.mockResolvedValue(0.9)
    mocks.loadPrecedingAssistantText.mockResolvedValue('Q?')
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
      expect.objectContaining({ code: 'REPORT_CHUNK_SEARCH_FAILED', severity: 'warning' }),
    )
  })

  it('EMBEDDING 未設定（RAG 無効）は logError せずチャンクなしで継続（B-8: ログ洪水の防止）', async () => {
    mocks.getEmbeddingClient.mockImplementation(() => {
      throw new EmbeddingNotConfiguredError()
    })
    await expect(executeProcessSlackMessage(db, payload)).resolves.toBeUndefined()
    expect(mocks.postMessage).toHaveBeenCalledOnce()
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('画像があれば Vision モデルで生成し画像を渡す（FR-06, BR-05-15）', async () => {
    const imgPayload = {
      ...payload,
      files: [{ id: 'F1', name: 'q.png', mimetype: 'image/png', size: 100, urlPrivate: 'https://slack/F1' }],
    }
    mocks.processAttachments.mockResolvedValue({ dataUrls: ['data:image/png;base64,AAA'], errorCodes: [] })
    await executeProcessSlackMessage(db, imgPayload)
    const genArg = mocks.generate.mock.calls[0][0]
    // Vision モデル（LLM_MODEL_COMPLEX = test-complex-model）
    expect(genArg.model).toBe('test-complex-model')
    // 画像がメッセージに含まれる
    const lastMsg = genArg.messages.at(-1)
    expect(Array.isArray(lastMsg.content)).toBe(true)
    expect(lastMsg.content.some((p: { type: string }) => p.type === 'image')).toBe(true)
    // usage は hasImage
    expect(mocks.logUsage.mock.calls[0][1].hasImage).toBe(true)
  })

  it('画像のみで全画像失敗 + テキストなし → エラー文言を返し LLM を呼ばない', async () => {
    mocks.processAttachments.mockResolvedValue({ dataUrls: [], errorCodes: ['SLACK_FILE_DOWNLOAD_FAILED'] })
    await executeProcessSlackMessage(db, imageOnlyPayload)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.postMessage).toHaveBeenCalledOnce() // エラー文言
  })

  it('非対応形式は「取得に失敗」ではなく対応形式の案内を返す', async () => {
    mocks.processAttachments.mockResolvedValue({
      dataUrls: [],
      errorCodes: ['UNSUPPORTED_FILE_TYPE'],
    })
    await executeProcessSlackMessage(db, imageOnlyPayload)
    expect(mocks.postMessage.mock.calls[0][0].text).toBe(
      getUserFacingMessage('UNSUPPORTED_FILE_TYPE'),
    )
  })

  it('サイズ超過と非対応形式が混在したらサイズ超過を優先して案内する', async () => {
    mocks.processAttachments.mockResolvedValue({
      dataUrls: [],
      errorCodes: ['UNSUPPORTED_FILE_TYPE', 'IMAGE_TOO_LARGE'],
    })
    await executeProcessSlackMessage(db, imageOnlyPayload)
    expect(mocks.postMessage.mock.calls[0][0].text).toBe(getUserFacingMessage('IMAGE_TOO_LARGE'))
  })

  // --- A-4: 質問の保存タイミング ---
  it('質問の保存は回答生成の「前」（並行時の文脈欠落防止, A-4）', async () => {
    await executeProcessSlackMessage(db, payload)
    const userSave = mocks.saveMessage.mock.calls.find((c) => c[1].role === 'user')!
    const userSaveOrder =
      mocks.saveMessage.mock.invocationCallOrder[mocks.saveMessage.mock.calls.indexOf(userSave)]
    expect(userSaveOrder).toBeLessThan(mocks.generate.mock.invocationCallOrder[0])
    expect(userSave[1].text).toBe('二次方程式がわからない')
  })

  it('質問の保存は履歴ロードの「後」（プロンプトに質問が二重に載らない, A-4）', async () => {
    mocks.loadThreadHistory.mockResolvedValue([{ role: 'user', content: '前の質問' }])
    await executeProcessSlackMessage(db, payload)
    const userSaveOrder = mocks.saveMessage.mock.invocationCallOrder[0]
    expect(mocks.loadThreadHistory.mock.invocationCallOrder[0]).toBeLessThan(userSaveOrder)

    // buildPrompt の messages に「今回の質問」が1回だけ現れる
    const genMessages = mocks.generate.mock.calls[0][0].messages as Array<{ content: unknown }>
    const occurrences = genMessages.filter((m) => m.content === '二次方程式がわからない')
    expect(occurrences).toHaveLength(1)
    expect(genMessages.at(-1)!.content).toBe('二次方程式がわからない')
  })

  it('質問の保存に失敗しても回答は生成・送信する（ベストエフォート）', async () => {
    mocks.saveMessage.mockRejectedValue(new Error('db blip'))
    await expect(executeProcessSlackMessage(db, payload)).resolves.toBeUndefined()
    expect(mocks.generate).toHaveBeenCalledOnce()
    expect(mocks.postMessage).toHaveBeenCalledOnce()
  })

  // --- A-3: 生成と配信の分離 ---
  it('生成結果を投稿の前に jobs.result_text へ退避する（A-3）', async () => {
    const ctx = { jobId: 'job1' }
    await executeProcessSlackMessage(db, payload, ctx)
    expect(jobUpdates).toContainEqual({ result_text: '一緒に整理しよう' })
    expect(ctx).toMatchObject({ resultText: '一緒に整理しよう' })
  })

  it('result_text が既にあれば再生成せず配信からやり直す（二重課金の防止, A-3）', async () => {
    await executeProcessSlackMessage(db, payload, { jobId: 'job1', resultText: '生成済みの回答' })
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.logUsage).not.toHaveBeenCalled() // 課金は前 attempt で記録済み
    expect(mocks.postMessage).toHaveBeenCalledWith({
      channel: 'C1',
      text: '生成済みの回答',
      threadTs: '100.1',
    })
    // 回答の履歴保存だけは配信の一部として行う
    expect(mocks.saveMessage).toHaveBeenCalledOnce()
    expect(mocks.saveMessage.mock.calls[0][1].role).toBe('assistant')
  })

  it('投稿が失敗しても生成分の利用量は記録済み（コスト過少計上の防止, A-3）', async () => {
    mocks.postMessage.mockRejectedValue(new Error('slack down'))
    const ctx = { jobId: 'job1' }
    await expect(executeProcessSlackMessage(db, payload, ctx)).rejects.toBeTruthy()
    expect(mocks.logUsage).toHaveBeenCalledOnce()
    expect(mocks.logUsage.mock.calls[0][1].usage).toEqual({ inputTokens: 100, outputTokens: 40 })
    // 生成結果も退避済みなので、リトライされても再生成されない
    expect(jobUpdates).toContainEqual({ result_text: '一緒に整理しよう' })
    expect(ctx).toMatchObject({ resultText: '一緒に整理しよう' })
  })

  it('利用量の記録は投稿より先に行う（A-3）', async () => {
    await executeProcessSlackMessage(db, payload)
    expect(mocks.logUsage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.postMessage.mock.invocationCallOrder[0],
    )
  })

  // --- C-3: Slack エスケープ ---
  it('LLM 生成テキストをエスケープしてから投稿する（<!channel> インジェクション防止, C-3）', async () => {
    mocks.generate.mockResolvedValue({
      text: 'x < 5 のとき <!channel> と書くと危ない & 注意',
      usage: { inputTokens: 10, outputTokens: 5 },
      model: 'test-default-model',
    })
    await executeProcessSlackMessage(db, payload)
    expect(mocks.postMessage.mock.calls[0][0].text).toBe(
      'x &lt; 5 のとき &lt;!channel&gt; と書くと危ない &amp; 注意',
    )
  })

  it('履歴には未エスケープの原文を保存する（次ターンの LLM 入力を壊さない, C-3）', async () => {
    mocks.generate.mockResolvedValue({
      text: 'x < 5',
      usage: { inputTokens: 10, outputTokens: 5 },
      model: 'test-default-model',
    })
    await executeProcessSlackMessage(db, payload)
    const assistantSave = mocks.saveMessage.mock.calls.find((c) => c[1].role === 'assistant')!
    expect(assistantSave[1].text).toBe('x < 5')
  })

  // --- A-15 / G-3: 出力打ち切り ---
  it('finish_reason=length の打ち切りを検知して案内を添える（A-15 / G-3）', async () => {
    mocks.generate.mockResolvedValue({
      text: '途中まで説明したところで',
      usage: { inputTokens: 10, outputTokens: 1200 },
      model: 'test-default-model',
      truncated: true,
    })
    await executeProcessSlackMessage(db, payload)
    expect(mocks.postMessage.mock.calls[0][0].text).toBe(
      `途中まで説明したところで${TRUNCATED_ANSWER_NOTICE}`,
    )
    expect(TRUNCATED_ANSWER_NOTICE).toContain('続きを教えて')
  })

  it('打ち切られていなければ案内は付かない', async () => {
    await executeProcessSlackMessage(db, payload)
    expect(mocks.postMessage.mock.calls[0][0].text).toBe('一緒に整理しよう')
  })
})
