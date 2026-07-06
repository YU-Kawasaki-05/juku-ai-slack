/** @file
 * 機能: process_slack_message ジョブの実処理（セッション確保 → 履歴/プロフィール取得 →
 *       モード選択 → AI 回答生成 → Slack 返信 → メッセージ保存 → 利用量記録）
 * 入力: Supabase クライアント, ProcessSlackMessagePayload
 * 出力: なし
 * 例外: LLM/Slack 失敗は上位（processJob のリトライ）に伝播
 * 依存: thread-sessions, ai-answer, student-profiles, student-knowledge, slack-messages, usage-logs, Slack client
 * 副作用: セッション/メッセージ/利用量ログの DB 書き込み, Slack への返信投稿, LLM 呼び出し
 * セキュリティ: person_id は payload（channel_id 解決済み）のみ使用（BR-05-11）。LLM 応答のみ Slack に出す
 * @implements FR-05, FR-03, FR-12, AC-05-01, AC-05-09
 */
import type { ServerDb } from '@shared/types/db'
import { env } from '@shared/lib/env'
import { MAX_QUESTION_CHARS } from '@shared/lib/constants'
import { AiResponseFailedError, TokenBudgetExceededError } from '@shared/lib/errors/AppError'
import { getOrCreateSession } from '@features/thread-sessions'
import { postMessage } from '@shared/lib/slack/client'
import { stripBotMention } from '@features/slack-events'
import { getStudentProfile } from '@features/student-profiles'
import { getMastery, getKnowledgeSummary, evaluate, applyEvaluation } from '@features/student-knowledge'
import { loadThreadHistory, saveMessage } from '@features/slack-messages'
import { logUsage } from '@features/usage-logs'
import { logError } from '@features/error-logs'
import { selectMode, generateAnswer, calculateCost, getLlmClient } from '@features/ai-answer'
import type { LlmMessage } from '@features/ai-answer'
import { searchChunks, getEmbeddingClient } from '@features/rag'
import type { ProcessSlackMessagePayload } from '../types'

export async function executeProcessSlackMessage(
  db: ServerDb,
  payload: ProcessSlackMessagePayload,
): Promise<void> {
  const nowIso = new Date().toISOString()

  await getOrCreateSession(db, {
    teamId: payload.teamId,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    personId: payload.personId,
    reportId: payload.reportId,
    nowIso,
  })

  const model = env.LLM_MODEL_DEFAULT
  if (!model) {
    throw new AiResponseFailedError('LLM_MODEL_DEFAULT が未設定です')
  }

  const question = stripBotMention(payload.text ?? '', env.SLACK_BOT_USER_ID)

  // 入力コスト暴走防止（BR: TOKEN_BUDGET_EXCEEDED）。LLM 呼び出し前に打ち切る
  if (question.length > MAX_QUESTION_CHARS) {
    throw new TokenBudgetExceededError()
  }

  // 生徒データ（他生徒を混入させない。person_id で厳密にフィルタ）
  const [profile, history, knowledgeSummary] = await Promise.all([
    getStudentProfile(db, payload.personId),
    loadThreadHistory(db, payload.channelId, payload.threadTs, payload.personId),
    getKnowledgeSummary(db, payload.personId),
  ])
  // Sprint 3 時点ではトピック検出（質問時）未実装のため topic=null（デフォルト P → direct）。
  // 知識状態は knowledgeSummary としてプロンプトに注入し、LLM がトピック別に適応できるようにする（AC-23-05）
  const pMastery = await getMastery(db, payload.personId, null)

  const mode = selectMode({ pMastery, examMode: profile.examMode })

  // RAG: レポート由来チャンクを検索（FR-10）。失敗はチャンクなしで継続（BR）
  const ragChunks = await searchReportChunks(db, payload, question)

  const startedAt = Date.now()
  const result = await generateAnswer(getLlmClient(), {
    mode,
    question,
    profileText: profile.profileText,
    history,
    ragChunks,
    knowledgeSummary,
    model,
  })
  const latencyMs = Date.now() - startedAt

  const posted = await postMessage({
    channel: payload.channelId,
    text: result.text,
    threadTs: payload.threadTs,
  })

  // 返信送信後の副作用はベストエフォート（ここで throw すると processJob が execute を
  // 再実行し二重返信・二重課金になるため、失敗してもログのみで握りつぶす）
  try {
    // 会話履歴の保存（次ターンの文脈に使う）: 生徒質問 → AI 回答
    await saveMessage(db, {
      teamId: payload.teamId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      slackUserId: payload.userId,
      personId: payload.personId,
      role: 'user',
      text: question,
    })
    await saveMessage(db, {
      teamId: payload.teamId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      // AI 返信の ts（取得できれば）。無ければ元メッセージ ts に紐付けて衝突回避
      messageTs: posted.ts || `${payload.messageTs}-ai`,
      personId: payload.personId,
      role: 'assistant',
      text: result.text,
    })
  } catch (e) {
    console.error('[executeProcessMessage] failed to persist thread messages:', e)
  }

  // コスト計算・記録は要求モデル（設定値）で行う。プロバイダのエコー名は名前空間/版差で
  // MODEL_PRICING と一致しないことがあるため（logUsage は失敗を握りつぶす）
  await logUsage(db, {
    personId: payload.personId,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    messageTs: payload.messageTs,
    model,
    usage: result.usage,
    estimatedCost: calculateCost(model, result.usage),
    hasImage: false,
    latencyMs,
  })

  // Evaluator（2エージェント構成）: 返信送信後に非同期で BKT を更新する。
  // BR-23-06: 失敗は AI 回答を妨げない（サイレントフェイル + ai_error_logs 記録）
  await runEvaluator(db, payload, question, history, model)
}

/** レポート由来チャンクを検索する。失敗・未設定はチャンクなしで継続（FR-10 エラーケース） */
async function searchReportChunks(
  db: ServerDb,
  payload: ProcessSlackMessagePayload,
  queryText: string,
): Promise<string[]> {
  try {
    const chunks = await searchChunks(db, getEmbeddingClient(), {
      personId: payload.personId,
      queryText,
    })
    return chunks.map((c) => c.content)
  } catch (err) {
    // REPORT_CHUNK_SEARCH_FAILED（サイレント）: チャンクなしで回答を継続
    await logError(db, {
      code: 'REPORT_CHUNK_SEARCH_FAILED',
      severity: 'warning',
      personId: payload.personId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      internalMessage: `rag search failed: ${err instanceof Error ? err.message : String(err)}`,
      rawError: err,
    })
    return []
  }
}

/** 直前の Bot 確認質問に対する生徒返信を評価し BKT を更新する（FR-23。失敗は握りつぶす） */
async function runEvaluator(
  db: ServerDb,
  payload: ProcessSlackMessagePayload,
  studentReply: string,
  history: LlmMessage[],
  model: string,
): Promise<void> {
  // 生徒返信が答える対象＝直前の assistant（Bot の確認質問）。無ければ評価しない
  const botQuestion = [...history].reverse().find((m) => m.role === 'assistant')?.content
  if (!botQuestion) return

  try {
    const { evaluation, result: evalResult } = await evaluate(
      getLlmClient(),
      { botQuestion, studentReply },
      model,
    )
    const applied = await applyEvaluation(db, payload.personId, evaluation)

    // AC-23-07: 低確信度は BKT 更新せず LOW_CONFIDENCE_SKIP を記録
    if (!applied.updated && applied.reason === 'low_confidence') {
      await logError(db, {
        code: 'LOW_CONFIDENCE_SKIP',
        severity: 'info',
        personId: payload.personId,
        channelId: payload.channelId,
        threadTs: payload.threadTs,
        messageTs: payload.messageTs,
        internalMessage: `evaluator confidence ${evaluation.confidence} < threshold`,
      })
    }

    // Evaluator の利用量も記録（FR-12）
    await logUsage(db, {
      personId: payload.personId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: `${payload.messageTs}-eval`,
      model,
      usage: evalResult.usage,
      estimatedCost: calculateCost(model, evalResult.usage),
      hasImage: false,
    })
  } catch (err) {
    // BR-23-06: 評価失敗は回答を妨げない
    await logError(db, {
      code: 'AI_RESPONSE_FAILED',
      severity: 'warning',
      personId: payload.personId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      internalMessage: `evaluator failed: ${err instanceof Error ? err.message : String(err)}`,
      rawError: err,
    })
  }
}
