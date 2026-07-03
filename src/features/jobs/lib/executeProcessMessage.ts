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
import { getMastery } from '@features/student-knowledge'
import { loadThreadHistory, saveMessage } from '@features/slack-messages'
import { logUsage } from '@features/usage-logs'
import { selectMode, generateAnswer, calculateCost, getLlmClient } from '@features/ai-answer'
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
  const [profile, history] = await Promise.all([
    getStudentProfile(db, payload.personId),
    loadThreadHistory(db, payload.channelId, payload.threadTs, payload.personId),
  ])
  // Sprint 2 はトピック検出未実装のため topic=null（デフォルト P → direct）
  const pMastery = await getMastery(db, payload.personId, null)

  const mode = selectMode({ pMastery, examMode: profile.examMode })

  const startedAt = Date.now()
  const result = await generateAnswer(getLlmClient(), {
    mode,
    question,
    profileText: profile.profileText,
    history,
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
}
