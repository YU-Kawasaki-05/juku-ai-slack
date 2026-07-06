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
  deriveEventFacts,
  stripBotMention,
  shouldReact,
  slackEnvelopeSchema,
  slackMessageEventSchema,
} from '@features/slack-events'
import { lookupBinding } from '@features/channel-bindings'
import { findSession } from '@features/thread-sessions'
import { enqueueJob, processJob, type ProcessSlackMessagePayload } from '@features/jobs'

export const runtime = 'nodejs'

/** Response のボディは一度しか読めないため、都度新しいインスタンスを返す */
function ok(): NextResponse {
  return NextResponse.json({ ok: true })
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
    after(() =>
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

    // 反応候補: 紐付けとセッション存在を確認
    const { status: bindingStatus, binding } = await lookupBinding(db, messageEvent.channel)
    const sessionExists = facts.isThreadReply
      ? Boolean(await findSession(db, messageEvent.channel, facts.threadTs))
      : false

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
      after(async () => {
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
      })
      return ok()
    }

    if (decision.action === 'channel_not_bound') {
      // BR-02-05: 紐付けなしはユーザーに案内 + ログ（ACK 後に実行）
      const notBoundMsg = getUserFacingMessage('CHANNEL_NOT_BOUND')
      after(async () => {
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

    // BR-04-01 / AC-04-01: ACK 前にジョブ登録
    const jobId = await enqueueJob(db, payload)

    // DEC-13: ACK 後に waitUntil 相当（after）でバックグラウンド処理
    after(() => processJob(db, jobId))

    return ok()
  } catch (err) {
    // 一過性エラーで質問が恒久消失しないよう receipt を削除し、500 で Slack 再送を促す（H-1）
    await deleteReceipt(db, event_id)
    after(() =>
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
