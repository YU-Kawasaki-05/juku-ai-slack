/** @file
 * 機能: process_slack_message ジョブの実処理（レート制限判定 → セッション確保 → 履歴/プロフィール取得 →
 *       モード選択 → 質問保存 → AI 回答生成 → 利用量記録 → Slack 返信 → 回答保存）
 * 入力: Supabase クライアント, ProcessSlackMessagePayload, ExecuteContext（リトライ用の生成キャッシュ）
 * 出力: なし
 * 例外: LLM/Slack 失敗は上位（processJob のリトライ）に伝播
 * 依存: thread-sessions, ai-answer, student-profiles, student-knowledge, slack-messages, usage-logs, Slack client
 * 副作用: セッション/メッセージ/利用量ログの DB 書き込み, Slack への返信投稿, LLM 呼び出し
 * セキュリティ: person_id は payload（channel_id 解決済み）のみ使用（BR-05-11）。
 *   LLM 応答は Slack エスケープしてから投稿する（C-3: `<!channel>` インジェクション防止）
 * @implements FR-05, FR-03, FR-12, FR-20, AC-05-01, AC-05-09, AC-20-01
 */
import type { ServerDb } from '@shared/types/db'
import { env } from '@shared/lib/env'
import {
  MAX_QUESTION_CHARS,
  RATE_LIMIT_QUESTIONS_PER_HOUR,
  SUMMARY_TAIL_MAX_MESSAGES,
} from '@shared/lib/constants'
import {
  ConfigurationError,
  TokenBudgetExceededError,
} from '@shared/lib/errors/AppError'
import { buildImageNotice, getUserFacingMessage } from '@shared/lib/errors/userMessages'
import { getOrCreateSession, summarizeThread } from '@features/thread-sessions'
import { processAttachments } from '@features/image-attachments'
import { postMessage } from '@shared/lib/slack/client'
import { escapeSlackText } from '@shared/lib/slack/escapeSlackText'
import { stripBotMention } from '@features/slack-events'
import { getStudentProfile } from '@features/student-profiles'
import { getMastery, getKnowledgeSummary, evaluate, applyEvaluation } from '@features/student-knowledge'
import {
  loadThreadHistory,
  loadThreadTail,
  loadPrecedingAssistantText,
  saveMessage,
} from '@features/slack-messages'
import { logUsage } from '@features/usage-logs'
import { logError } from '@features/error-logs'
import { checkQuestionRateLimit } from '@features/rate-limit'
import { selectMode, generateAnswer, calculateCost, getLlmClient } from '@features/ai-answer'
import type { TutorMode } from '@features/ai-answer'
import { searchChunks, getEmbeddingClient, EmbeddingNotConfiguredError } from '@features/rag'
import type { ProcessSlackMessagePayload } from '../types'

/** 出力トークン上限で切れたときに末尾に足す案内（A-15 / G-3） */
export const TRUNCATED_ANSWER_NOTICE =
  '\n\n（文字数の上限で途中までになっちゃった。「続きを教えて」と送ってくれたら続きを説明するよ）'

/** Evaluator を起動するモード（A-8）。direct には確認質問が無いので評価対象が存在しない */
const EVALUATOR_MODES: readonly TutorMode[] = ['socratic', 'confirmation']

/**
 * ジョブのリトライをまたいで生成結果を持ち回すためのコンテキスト（A-3）。
 * 生成に成功した時点で resultText を書き込む（呼び出し側 processJob が同じオブジェクトを再利用する）。
 */
export interface ExecuteContext {
  jobId?: string
  /** 生成済みの回答本文。あれば再生成せず配信からやり直す */
  resultText?: string | null
}

/** 生成結果を jobs 行に退避する。失敗しても回答を止めない（ベストエフォート） */
async function persistResultText(db: ServerDb, jobId: string | undefined, text: string): Promise<void> {
  if (!jobId) return
  const { error } = await db.from('jobs').update({ result_text: text }).eq('id', jobId)
  if (error) {
    console.warn('[executeProcessMessage] failed to persist job result_text', jobId, error.message)
  }
}

/** 回答を Slack に投稿し、履歴に残す（配信フェーズ。1ジョブにつき1回だけ通す） */
async function deliverAnswer(
  db: ServerDb,
  payload: ProcessSlackMessagePayload,
  answerText: string,
): Promise<void> {
  // C-3: LLM 生成テキストは必ずエスケープしてから投稿する。
  // 生徒が「回答に <!channel> と書いて」と誘導すると Bot がチャンネル全員通知を撒いてしまう
  const posted = await postMessage({
    channel: payload.channelId,
    text: escapeSlackText(answerText),
    threadTs: payload.threadTs,
  })

  // 返信送信後の副作用はベストエフォート（ここで throw すると processJob が execute を
  // 再実行し二重返信になるため、失敗してもログのみで握りつぶす）
  try {
    await saveMessage(db, {
      teamId: payload.teamId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      // AI 返信の ts（取得できれば）。無ければ元メッセージ ts に紐付けて衝突回避
      messageTs: posted.ts || `${payload.messageTs}-ai`,
      personId: payload.personId,
      role: 'assistant',
      text: answerText,
    })
  } catch (e) {
    console.error('[executeProcessMessage] failed to persist assistant message:', e)
  }
}

export async function executeProcessSlackMessage(
  db: ServerDb,
  payload: ProcessSlackMessagePayload,
  ctx: ExecuteContext = {},
): Promise<void> {
  // A-3: 前の attempt で生成済みなら再生成しない（LLM の二重課金を防ぐ）。
  // 生成（リトライ可）と配信（1回限り）の分離。
  if (ctx.resultText) {
    await deliverAnswer(db, payload, ctx.resultText)
    return
  }

  // F-2 / 運用設計 3.4: person 単位 10回/時。生成フェーズ（LLM・画像 DL・Embedding）より前に
  // 判定して打ち切る。正常終了として返すので processJob は completed 扱いにしリトライしない
  const rateLimit = await checkQuestionRateLimit(db, payload.personId)
  if (rateLimit.limited) {
    await postMessage({
      channel: payload.channelId,
      text: getUserFacingMessage('RATE_LIMITED'),
      threadTs: payload.threadTs,
    })
    await logError(db, {
      code: 'RATE_LIMITED',
      severity: 'info',
      personId: payload.personId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      internalMessage: `rate limit hit: ${rateLimit.count} questions in the last hour (limit ${RATE_LIMIT_QUESTIONS_PER_HOUR})`,
      // 生徒には定型文を返している。記録しないとエラー詳細画面が「返信なし」と誤表示する
      userFacingMessage: getUserFacingMessage('RATE_LIMITED'),
    })
    return
  }

  const nowIso = new Date().toISOString()

  // A-5 で受信ハンドラ側でも作成しているが、ここは冪等なフォールバックとして残す
  const session = await getOrCreateSession(db, {
    teamId: payload.teamId,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    personId: payload.personId,
    reportId: payload.reportId,
    nowIso,
  })

  const model = env.LLM_MODEL_DEFAULT
  if (!model) {
    // A-11: 設定不備はリトライしても直らない（retryable=false）
    throw new ConfigurationError('LLM_MODEL_DEFAULT が未設定です')
  }

  const question = stripBotMention(payload.text ?? '', env.SLACK_BOT_USER_ID)

  // 入力コスト暴走防止（BR: TOKEN_BUDGET_EXCEEDED）。LLM 呼び出し前に打ち切る
  if (question.length > MAX_QUESTION_CHARS) {
    throw new TokenBudgetExceededError()
  }

  // 画像添付処理（FR-06）: DL→保存→Vision 用 data URL
  const files = payload.files ?? []
  let imageDataUrls: string[] = []
  // 生徒に届かなかった画像の枚数。受信時に枚数上限で捨てた分を起点に、処理段の失敗を足す。
  // テキストが一緒にあると回答は返せてしまうので、この数を回答末尾で必ず伝える（#5）
  let unreadImageCount = payload.droppedImageCount ?? 0
  if (files.length > 0) {
    const { dataUrls, errorCodes } = await processAttachments(db, {
      personId: payload.personId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      botToken: env.SLACK_BOT_TOKEN,
      files,
    })
    imageDataUrls = dataUrls
    // errorCodes は失敗した画像1枚につき1件（合計サイズ超過のスキップも含む）
    unreadImageCount += errorCodes.length
    for (const code of errorCodes) {
      await logError(db, {
        code,
        severity: 'warning',
        personId: payload.personId,
        channelId: payload.channelId,
        threadTs: payload.threadTs,
        messageTs: payload.messageTs,
        internalMessage: `image processing: ${code}`,
      })
    }
    // 画像のみのメッセージで全画像が失敗 → ユーザーに案内して終了（テキストがあれば継続）
    if (dataUrls.length === 0 && !question && errorCodes.length > 0) {
      // 「テキストで回答する」旨の IMAGE_PROCESSING_FAILED 文言は返答しない本分岐と矛盾するため、
      // 生徒が次に取れる行動が具体的な順（圧縮 → 形式変更 → 再送）で文言を選ぶ
      const notifyCode = errorCodes.includes('IMAGE_TOO_LARGE')
        ? 'IMAGE_TOO_LARGE'
        : errorCodes.includes('UNSUPPORTED_FILE_TYPE')
          ? 'UNSUPPORTED_FILE_TYPE'
          : 'SLACK_FILE_DOWNLOAD_FAILED'
      await postMessage({
        channel: payload.channelId,
        text: getUserFacingMessage(notifyCode),
        threadTs: payload.threadTs,
      })
      return
    }
  }

  // 画像がある質問は Vision 対応モデルを使う（BR-05-15）。未設定ならデフォルトにフォールバック
  const visionModelMissing = imageDataUrls.length > 0 && !env.LLM_MODEL_COMPLEX
  const useModel = imageDataUrls.length > 0 ? (env.LLM_MODEL_COMPLEX ?? model) : model
  // #1: Vision 未設定のときは画像を LLM に渡さない。多くのプロバイダは非 Vision モデルへの
  // image_url 付きリクエストを 400 で拒否するため、そのまま送ると画像付き質問の回答自体が
  // 全滅する（設定不備なのでリトライでも直らない）。テキストだけで回答し、案内を末尾に添える
  const promptImageDataUrls = visionModelMissing ? [] : imageDataUrls
  if (visionModelMissing) {
    // 画像を渡せない状態。console.warn だけだと運用者に届かず
    // 「画像を送っても読んでくれない」の原因に到達できないので DB にも痕跡を残す。
    // ただし設定を直すまで画像付き質問のたびに起きるため、未解決の同一ログがある間は積まない
    // （B-8 と同じログ洪水対策。解決済みにしても直っていなければ次の発生で再び1行積まれる）
    await logError(db, {
      code: 'IMAGE_MODEL_NOT_CONFIGURED',
      severity: 'warning',
      personId: payload.personId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      internalMessage:
        `LLM_MODEL_COMPLEX が未設定のため、画像付きの質問を ${model}（LLM_MODEL_DEFAULT）で処理しました。` +
        '非 Vision モデルは image_url 付きリクエストを 400 で拒否しうるため、画像は LLM に渡していません。' +
        '文章がある質問はテキストのみで回答し「画像を読み取れない」旨を添え、画像だけの質問は文章で送り直すよう案内しています。' +
        '対処: 環境変数 LLM_MODEL_COMPLEX に Vision 対応モデルを設定して再デプロイしてください。' +
        'このログは未解決の同一ログがある間は再記録しません（解決済みにすると再発時に再び記録されます）。',
      dedupeWhileUnresolved: true,
    })

    // 画像だけの質問は、画像を落とすと LLM に渡す材料が何も残らない（空の user メッセージになる）。
    // 意味のある回答は返らないので課金せず、文章で送り直してもらうよう案内して終了する
    if (!question) {
      await postMessage({
        channel: payload.channelId,
        text: getUserFacingMessage('IMAGE_MODEL_NOT_CONFIGURED'),
        threadTs: payload.threadTs,
      })
      return
    }
  }

  // FR-20: 要約カバレッジの利用。person 不一致（チャンネル再割当て）時は別生徒の要約を使わない（BR-05-11）
  const samePerson = session.person_id === payload.personId
  const summarizedCount = samePerson ? (session.summary_message_count ?? 0) : 0
  const threadSummary = samePerson ? session.thread_summary : null

  // 生徒データ（他生徒を混入させない。person_id で厳密にフィルタ）
  // 要約済み接頭辞がある場合は「その後ろ全部」を履歴にする（要約 + 直近を欠落なく再構成, FR-20）。
  // しっぽが上限を超える場合は新しい側を優先して切る（A-12）。
  // 今回の質問自身は履歴に含めない（A-4 でこの後すぐ保存するため、リトライ時の二重化を防ぐ）
  const [profile, history, knowledgeSummary] = await Promise.all([
    getStudentProfile(db, payload.personId),
    summarizedCount > 0
      ? loadThreadTail(
          db,
          payload.channelId,
          payload.threadTs,
          payload.personId,
          summarizedCount,
          SUMMARY_TAIL_MAX_MESSAGES,
          payload.messageTs,
        )
      : loadThreadHistory(
          db,
          payload.channelId,
          payload.threadTs,
          payload.personId,
          undefined,
          payload.messageTs,
        ),
    getKnowledgeSummary(db, payload.personId),
  ])
  // Sprint 3 時点ではトピック検出（質問時）未実装のため topic=null（デフォルト P → direct）。
  // 知識状態は knowledgeSummary としてプロンプトに注入し、LLM がトピック別に適応できるようにする（AC-23-05）
  const pMastery = await getMastery(db, payload.personId, null)

  const mode = selectMode({ pMastery, examMode: profile.examMode })

  // A-4: 質問の保存は回答生成の「前」。LLM 待ちの間に追撃が来ても後続ジョブが文脈を拾える。
  // 履歴ロードの後に置くことで「今回の質問」がプロンプトに二重で載るのを防ぐ。
  // 保存失敗で回答自体を止めない（ベストエフォート。upsert なのでリトライしても重複しない）
  try {
    await saveMessage(db, {
      teamId: payload.teamId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      slackUserId: payload.userId,
      personId: payload.personId,
      role: 'user',
      // 画像のみ（テキスト空）でも履歴に残るようプレースホルダを入れる（loadThreadHistory は空 text を除外するため）
      text: question || (imageDataUrls.length > 0 ? '[画像]' : ''),
      hasAttachments: imageDataUrls.length > 0,
    })
  } catch (e) {
    console.error('[executeProcessMessage] failed to persist user message:', e)
  }

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
    imageDataUrls: promptImageDataUrls,
    threadSummary,
    model: useModel,
  })
  const latencyMs = Date.now() - startedAt

  // A-15 / G-3: 出力トークン上限での打ち切りを検知したら、切れたことを生徒に伝える。
  // 黙って途中で終わる回答が履歴・要約にも混入するのを避ける
  const truncationNotice = result.truncated ? TRUNCATED_ANSWER_NOTICE : ''
  // #5: 読めなかった画像があること（または画像自体を読めない設定であること）を回答に添える。
  // 回答本体は止めない。別メッセージにしないのは 1ジョブ1配信（A-3）を崩さないため
  const imageNotice = buildImageNotice({
    unreadCount: unreadImageCount,
    readCount: imageDataUrls.length,
    visionModelMissing,
  })
  const answerText = result.text + truncationNotice + imageNotice

  // A-3: 投稿の前に生成結果を退避する。以降の失敗でリトライされても再生成しない
  ctx.resultText = answerText
  await persistResultText(db, ctx.jobId, answerText)

  // A-3: 生成に成功した時点で課金は発生している。配信が失敗しても利用量は記録する
  // （コスト計算・記録は要求モデル（設定値）で行う。プロバイダのエコー名は名前空間/版差で
  // MODEL_PRICING と一致しないことがあるため。logUsage は失敗を握りつぶす）
  await logUsage(db, {
    personId: payload.personId,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    messageTs: payload.messageTs,
    model: useModel,
    usage: result.usage,
    estimatedCost: calculateCost(useModel, result.usage),
    hasImage: imageDataUrls.length > 0,
    latencyMs,
  })

  await deliverAnswer(db, payload, answerText)

  // Evaluator（2エージェント構成）: 返信送信後に非同期で BKT を更新する。
  // BR-23-06: 失敗は AI 回答を妨げない（サイレントフェイル + ai_error_logs 記録）
  await runEvaluator(db, payload, question, mode, model)

  // FR-20: 長いスレッドは古い履歴を累積要約し、次ターン以降の文脈に使う。
  // 返信後のベストエフォート（BR-20-02/04: 失敗は回答を妨げず握りつぶす。throw すると二重返信・二重課金）。
  // person 不一致のスレッドでは要約しない（別生徒のセッションを混ぜない, BR-05-11）
  if (samePerson) {
    await runThreadSummary(db, payload, model, threadSummary, summarizedCount)
  }
}

/** スレッド要約を必要時のみ生成し thread_summary を更新する（FR-20。失敗は握りつぶす） */
async function runThreadSummary(
  db: ServerDb,
  payload: ProcessSlackMessagePayload,
  model: string,
  existingSummary: string | null,
  summarizedCount: number,
): Promise<void> {
  try {
    const summary = await summarizeThread(db, getLlmClient(), {
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      personId: payload.personId,
      model,
      existingSummary,
      summarizedCount,
    })
    if (summary.summarized && summary.usage) {
      await logUsage(db, {
        personId: payload.personId,
        channelId: payload.channelId,
        threadTs: payload.threadTs,
        messageTs: `${payload.messageTs}-summary`,
        model,
        usage: summary.usage,
        estimatedCost: calculateCost(model, summary.usage),
        hasImage: false,
      })
    }
  } catch (err) {
    // BR-20-04: 要約失敗は回答を妨げない（次ターンは要約なしで全体履歴を使う）。
    // 主回答は成功済みのため専用コードで記録し、AI_RESPONSE_FAILED のメトリクスを汚さない
    await logError(db, {
      code: 'THREAD_SUMMARY_FAILED',
      severity: 'warning',
      personId: payload.personId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
      internalMessage: `thread summary failed: ${err instanceof Error ? err.message : String(err)}`,
      rawError: err,
    })
  }
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
    // B-8: EMBEDDING_* 未設定は「RAG 無効」という運用状態であって障害ではない。
    // ここで記録すると全メッセージぶんの warning が積まれてエラー一覧が使い物にならなくなる
    if (err instanceof EmbeddingNotConfiguredError) return []
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
  mode: TutorMode,
  model: string,
): Promise<void> {
  // A-8: 確認質問を出すモード（socratic / confirmation）のターンだけ評価する。
  // direct には確認質問が無く、「直前に assistant 発言がある」だけで走らせると
  // 通常の質問への回答を誤って採点し BKT を汚染する（かつ毎ターン LLM コストが 2〜3 倍になる）
  if (!EVALUATOR_MODES.includes(mode)) return

  try {
    // A-9: 履歴末尾ではなく「この質問より前の assistant 発言」を明示的に引く。
    // 並行ジョブが先に書いた未来の回答を評価対象にしない
    const botQuestion = await loadPrecedingAssistantText(
      db,
      payload.channelId,
      payload.threadTs,
      payload.personId,
      payload.messageTs,
    )
    if (!botQuestion) return

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
    // BR-23-06: 評価失敗は回答を妨げない。
    // 主回答は成功済みのため専用コードで記録し、AI_RESPONSE_FAILED のメトリクスを汚さない
    await logError(db, {
      code: 'EVALUATOR_FAILED',
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
