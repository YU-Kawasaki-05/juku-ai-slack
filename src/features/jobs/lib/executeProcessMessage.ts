/** @file
 * 機能: process_slack_message ジョブの実処理（Sprint 1: セッション確保 + 暫定返信）
 * 入力: Supabase クライアント, ProcessSlackMessagePayload
 * 出力: なし
 * 例外: Slack 送信失敗等は上位（processJob のリトライ）に伝播
 * 依存: thread-sessions, Slack client
 * 副作用: セッション行の作成/更新, Slack への返信投稿
 * セキュリティ: person_id は payload（channel_id 解決済み）のみ使用
 * @implements FR-03, FR-05, AC-03-01, AC-03-02
 */
import type { ServerDb } from '@shared/types/db'
import { getOrCreateSession } from '@features/thread-sessions'
import { postMessage } from '@shared/lib/slack/client'
import { SPRINT1_ACK_REPLY } from '@shared/lib/constants'
import type { ProcessSlackMessagePayload } from '../types'

export async function executeProcessSlackMessage(
  db: ServerDb,
  payload: ProcessSlackMessagePayload,
): Promise<void> {
  await getOrCreateSession(db, {
    teamId: payload.teamId,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    personId: payload.personId,
    reportId: payload.reportId,
    nowIso: new Date().toISOString(),
  })

  // Sprint 1: 暫定の受付返信。Sprint 2 で AI 回答に置換する
  await postMessage({
    channel: payload.channelId,
    text: SPRINT1_ACK_REPLY,
    threadTs: payload.threadTs,
  })
}
