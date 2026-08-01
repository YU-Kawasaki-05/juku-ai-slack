/** @file
 * 機能: Slack Events API Webhook エンドポイント（署名検証→重複排除→反応制御→ジョブ登録→ACK）
 * 入力: POST body（raw）, x-slack-signature, x-slack-request-timestamp
 * 出力: url_verification は {challenge}、event_callback は {ok:true}(200)、署名NGは401
 * 例外: 署名NG→401 / JSON不正→400 / それ以外は200で握る（Slackへは通知しない）
 * 依存: env, Supabase Service Role, slack-events, channel-bindings, thread-sessions, jobs
 * 副作用: slack_event_receipts 記録, jobs 登録, after() で Slack 送信/リアクション/エラーログ
 * セキュリティ: 署名検証必須。person_id は channel_id 解決（binding）からのみ取得しクライアント値を信用しない
 * @implements FR-01, FR-02, FR-04, AC-01-01, AC-01-02, AC-01-03, AC-01-04, AC-01-05, AC-02-01, AC-02-02, AC-02-03, AC-02-04, AC-02-05, AC-02-06
 */
import { after, NextResponse } from 'next/server'
import { env } from '@shared/lib/env'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getUserFacingMessage } from '@shared/lib/errors/userMessages'
import { postMessage } from '@shared/lib/slack/client'
import { logError } from '@features/error-logs'
import {
  verifySlackSignature,
  recordEventReceipt,
  deleteReceipt,
  markReceiptStatus,
  deriveEventFacts,
  stripBotMention,
  shouldReact,
  slackEnvelopeSchema,
  slackMessageEventSchema,
} from '@features/slack-events'
import { lookupBinding } from '@features/channel-bindings'
import { findSession, getOrCreateSession } from '@features/thread-sessions'
import { enqueueJob, processJob, type ProcessSlackMessagePayload } from '@features/jobs'
import type { ServerDb } from '@shared/types/db'

export const runtime = 'nodejs'

/**
 * A-1: after() 内の AI 処理（LLM 生成 + Slack 投稿 + 後処理）は既定の実行時間上限に収まらない。
 * kill されると jobs が processing のまま残り、🤔 も消えず生徒には無応答になるため上限を引き上げる。
 */
export const maxDuration = 300

/** Response のボディは一度しか読めないため、都度新しいインスタンスを返す */
function ok(): NextResponse {
  return NextResponse.json({ ok: true })
}

/**
 * A-2: after() のコールバックは誰も await しないため、throw すると完全に無音で消える。
 * 例外を必ず捕まえて ai_error_logs に残す（記録自体の失敗も握りつぶす）。
 */
function safeAfter(db: ServerDb, context: string, fn: () => Promise<unknown>): void {
  after(async () => {
    try {
      await fn()
    } catch (err) {
      try {
        await logError(db, {
          code: 'UNKNOWN_ERROR',
          severity: 'error',
          internalMessage: `after(${context}) failed: ${err instanceof Error ? err.message : String(err)}`,
          rawError: err,
        })
      } catch (logErr) {
        console.error('[slack/events] failed to log after() failure', context, logErr)
      }
    }
  })
}

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text()
  const signature = req.headers.get('x-slack-signature')
  const timestamp = req.headers.get('x-slack-request-timestamp')

  // BR-01-01 / BR-01-02: 署名・タイムスタンプ検証
  const sig = verifySlackSignature({
    signature,
    timestamp,
    rawBody,
    signingSecret: env.SLACK_SIGNING_SECRET,
  })
  if (!sig.valid) {
    // 未認証リクエストで DB 書き込みを誘発させないため、DB でなくサーバーログに記録する
    // （公開エンドポイントのため増幅・コスト増を防ぐ）
    console.warn('[slack/events] signature verification failed:', sig.reason)
    return new NextResponse('invalid signature', { status: 401 })
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return new NextResponse('bad request', { status: 400 })
  }

  const envelope = slackEnvelopeSchema.safeParse(json)
  if (!envelope.success) {
    // 未知の形状は無視（200）。Slack のリトライを止める
    return ok()
  }

  // AC-01-01: url_verification
  if (envelope.data.type === 'url_verification') {
    return NextResponse.json({ challenge: envelope.data.challenge })
  }

  const { event_id, team_id, event } = envelope.data

  // message 以外のイベントは対象外（ログなしで200）
  if (event.type !== 'message') {
    return ok()
  }
  const msg = slackMessageEventSchema.safeParse(event)
  if (!msg.success) {
    return ok()
  }
  const messageEvent = msg.data

  const db = createServerClient()

  // BR-01-03: 重複イベントは処理しない
  const receipt = await recordEventReceipt(db, {
    eventId: event_id,
    teamId: team_id,
    eventType: event.type,
    eventTs: messageEvent.ts,
  })
  if (receipt === 'duplicate') {
    // FR-01: SLACK_EVENT_DUPLICATE（severity: info）を記録（Slack への返信はなし）
    safeAfter(db, 'duplicate-log', () =>
      logError(db, {
        code: 'SLACK_EVENT_DUPLICATE',
        severity: 'info',
        channelId: messageEvent.channel,
        messageTs: messageEvent.ts,
        internalMessage: `duplicate event_id=${event_id}`,
      }),
    )
    return ok()
  }

  // receipt 記録済み。以降で失敗した場合は receipt を消して Slack 再送での再処理を可能にする（H-1 対策）
  try {
    const facts = deriveEventFacts(messageEvent, env.SLACK_BOT_USER_ID)
    const hasText = Boolean(facts.text && facts.text.trim())

    // DB 不要の早期 ignore（Bot自身・非file_share subtype・コンテンツなし・直下メンションなし）
    if (
      facts.hasBotId ||
      (facts.subtype && facts.subtype !== 'file_share') ||
      (!hasText && !facts.hasImage)
    ) {
      return ok()
    }
    if (!facts.isThreadReply && !facts.hasMention) {
      return ok()
    }

    // 反応候補: 紐付けとセッション存在を確認。
    // A-7: ACK は 3 秒以内に返す必要があるため、独立した 2 クエリは直列にしない
    const [bindingResult, existingSession] = await Promise.all([
      lookupBinding(db, messageEvent.channel),
      facts.isThreadReply ? findSession(db, messageEvent.channel, facts.threadTs) : null,
    ])
    const { status: bindingStatus, binding } = bindingResult
    const sessionExists = Boolean(existingSession)

    const decision = shouldReact({
      hasBotId: facts.hasBotId,
      subtype: facts.subtype,
      text: facts.text,
      hasImage: facts.hasImage,
      hasMention: facts.hasMention,
      isThreadReply: facts.isThreadReply,
      bindingStatus,
      sessionExists,
    })

    if (decision.action === 'ignore') {
      // H-6: 退塾生チャンネルは Slack に何も返さない。ただし運用で気づけるよう info だけ残す
      // （頻度が低い前提。増えるようなら binding 側を inactive にするのが正しい対処）
      if (decision.reason === 'person_inactive') {
        safeAfter(db, 'person-inactive-log', async () => {
          await logError(db, {
            code: 'PERSON_INACTIVE',
            severity: 'info',
            personId: binding?.person_id ?? null,
            channelId: messageEvent.channel,
            threadTs: facts.threadTs,
            messageTs: facts.messageTs,
            internalMessage: 'person is inactive; bot stayed silent',
          })
          await markReceiptStatus(db, event_id, 'skipped')
        })
      }
      return ok()
    }

    // AC-06-02: Bot に投げた（反応対象の）メッセージが「対応外ファイルのみ・実質テキストなし」なら
    // UNSUPPORTED_FILE_TYPE を返す。無言のファイル投下（非反応）は既に ignore 済みで対象外（BR-06-08 と両立）
    const hasFiles = (messageEvent.files?.length ?? 0) > 0
    const strippedText = stripBotMention(facts.text, env.SLACK_BOT_USER_ID)
    if (
      decision.action === 'process' &&
      hasFiles &&
      facts.images.length === 0 &&
      strippedText.length === 0
    ) {
      const unsupportedMsg = getUserFacingMessage('UNSUPPORTED_FILE_TYPE')
      safeAfter(db, 'unsupported-file', async () => {
        try {
          await postMessage({ channel: messageEvent.channel, text: unsupportedMsg, threadTs: facts.threadTs })
        } catch {
          // SLACK_POST_FAILED はサイレント
        }
        await logError(db, {
          code: 'UNSUPPORTED_FILE_TYPE',
          severity: 'warning',
          channelId: messageEvent.channel,
          threadTs: facts.threadTs,
          messageTs: facts.messageTs,
          userFacingMessage: unsupportedMsg,
        })
        await markReceiptStatus(db, event_id, 'skipped')
      })
      return ok()
    }

    if (decision.action === 'channel_not_bound') {
      // BR-02-05: 紐付けなしはユーザーに案内 + ログ（ACK 後に実行）
      const notBoundMsg = getUserFacingMessage('CHANNEL_NOT_BOUND')
      safeAfter(db, 'channel-not-bound', async () => {
        try {
          await postMessage({ channel: messageEvent.channel, text: notBoundMsg, threadTs: facts.threadTs })
        } catch {
          // SLACK_POST_FAILED はサイレント
        }
        await logError(db, {
          code: 'CHANNEL_NOT_BOUND',
          severity: 'warning',
          channelId: messageEvent.channel,
          threadTs: facts.threadTs,
          messageTs: facts.messageTs,
          userFacingMessage: notBoundMsg,
        })
        await markReceiptStatus(db, event_id, 'skipped')
      })
      return ok()
    }

    // decision.action === 'process': binding は active（非null）
    // セキュリティ: person_id は binding（channel_id 解決）からのみ取得。event.user は認可に使わない
    const activeBinding = binding!
    const payload: ProcessSlackMessagePayload = {
      teamId: team_id,
      channelId: messageEvent.channel,
      messageTs: facts.messageTs,
      threadTs: facts.threadTs,
      userId: messageEvent.user ?? null,
      text: messageEvent.text ?? null,
      personId: activeBinding.person_id,
      reportId: activeBinding.default_report_id,
      eventId: event_id,
      // 対応画像のみ（url_private/mimetype 必須）。FR-06
      files: facts.images
        .filter((f) => f.url_private && f.mimetype)
        .map((f) => ({
          id: f.id,
          name: f.name ?? null,
          mimetype: f.mimetype as string,
          size: f.size ?? null,
          urlPrivate: f.url_private as string,
        })),
    }

    // A-5: セッション作成をジョブ内から受信ハンドラに前倒しする。
    // メンション直後〜ジョブ claim 完了までの窓に来たスレッド返信が
    // 「未登録スレッド」と判定されて無言破棄されるのを防ぐ（AC-02-03）。
    // executeProcessSlackMessage 側の getOrCreateSession は冪等なのでそのまま残す。
    if (!existingSession) {
      await getOrCreateSession(db, {
        teamId: team_id,
        channelId: messageEvent.channel,
        threadTs: facts.threadTs,
        personId: activeBinding.person_id,
        reportId: activeBinding.default_report_id,
        nowIso: new Date().toISOString(),
      })
    }

    // BR-04-01 / AC-04-01: ACK 前にジョブ登録
    const jobId = await enqueueJob(db, payload)

    // DEC-13: ACK 後に waitUntil 相当（after）でバックグラウンド処理
    // A-2: claim 失敗などの throw を握りつぶさず記録し、receipt に結果を残す
    safeAfter(db, 'process-job', async () => {
      const result = await processJob(db, jobId)
      await markReceiptStatus(
        db,
        event_id,
        result.status === 'completed' ? 'processed' : result.status === 'skipped' ? 'skipped' : 'failed',
      )
    })

    return ok()
  } catch (err) {
    // 一過性エラーで質問が恒久消失しないよう receipt を削除し、500 で Slack 再送を促す（H-1）
    await deleteReceipt(db, event_id)
    safeAfter(db, 'request-failure-log', () =>
      logError(db, {
        code: 'UNKNOWN_ERROR',
        severity: 'error',
        channelId: messageEvent.channel,
        messageTs: messageEvent.ts,
        internalMessage: err instanceof Error ? err.message : String(err),
        rawError: err,
      }),
    )
    return new NextResponse('internal error', { status: 500 })
  }
}
