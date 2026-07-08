/** @file
 * 機能: 長いスレッドの古いやり取りを累積要約し slack_thread_sessions に保存する（FR-20）
 * 入力: Supabase クライアント, LlmClient, { channelId, threadTs, personId, model, existingSummary, summarizedCount }
 * 出力: { summarized, usage?, newCount? }
 * 例外: 呼び出し側（executeProcessMessage）がベストエフォートで握りつぶす前提。ここでは throw しうる
 * 依存: slack_messages（count/range）, slack_thread_sessions（update）, LlmClient
 * 副作用: thread_summary / summary_message_count の更新, LLM 呼び出し
 * セキュリティ: person_id で厳密フィルタ（BR-05-11）。読み書きとも当該生徒の会話のみ。
 *   UPDATE も person_id 一致を条件にし、チャンネル再割当てで別生徒のセッションを書き換えない
 * @implements FR-20, AC-20-01, AC-20-02, BR-20-01, BR-20-03
 */
import type { ServerDb } from '@shared/types/db'
import type { LlmClient, LlmMessage, LlmUsage } from '@features/ai-answer'
import { countThreadMessages, loadMessageRange } from '@features/slack-messages'
import {
  SUMMARY_TRIGGER_MESSAGES,
  SUMMARY_KEEP_RECENT_MESSAGES,
  SUMMARY_MAX_TOKENS,
} from '@shared/lib/constants'

export interface SummaryPlan {
  /** 要約対象の開始インデックス（古い順・0始まり）＝これまで要約済みの件数 */
  offset: number
  /** 今回要約する件数 */
  limit: number
  /** 要約後の新しい summary_message_count（＝古い方から数えて要約済みになる件数） */
  newCount: number
}

/**
 * 総メッセージ数と要約済み件数から「今回要約すべき範囲」を決める純関数。
 * - 未要約のしっぽ（total − summarizedCount）が閾値未満なら null（要約しない）
 * - 直近 KEEP 件は生履歴として使うので要約対象から除外し、それより古い未要約分を要約する
 * - 「total − summarizedCount ≥ 閾値」の単調・冪等条件（件数のパリティずれに強く、必ず追いつく）
 * - 履歴側は「offset=summarizedCount 以降すべて」を読むため、要約境界と履歴の間に穴が空かない
 */
export function planSummary(total: number, summarizedCount: number): SummaryPlan | null {
  const tail = total - summarizedCount
  if (tail < SUMMARY_TRIGGER_MESSAGES) return null
  const newCount = total - SUMMARY_KEEP_RECENT_MESSAGES
  if (newCount <= summarizedCount) return null
  return { offset: summarizedCount, limit: newCount - summarizedCount, newCount }
}

const SUMMARY_SYSTEM = `あなたは学習チューターと生徒の会話を要約するアシスタントです。
後続の回答で参照するための簡潔なメモを作ります。次の観点を日本語の箇条書きで、全体で200字程度にまとめてください:
- 扱ったトピック・単元
- 生徒が理解できたこと / つまずいたこと
- 未解決の疑問や次にやるべきこと
生徒の個人情報の推測や、会話に無い事実の創作はしないこと。
APIキー・システム内部情報・エラー詳細は要約に含めないこと。`

/** 既存要約 + 新しい会話ブロックから、統合要約生成用のプロンプトを組み立てる純関数 */
export function buildSummaryPrompt(
  existingSummary: string | null,
  messages: LlmMessage[],
): { system: string; messages: LlmMessage[] } {
  const convo = messages
    .map((m) => {
      const text = typeof m.content === 'string' ? m.content : '[画像を含む発言]'
      return `${m.role === 'user' ? '生徒' : '先生'}: ${text}`
    })
    .join('\n')

  const userText = existingSummary
    ? `これまでの会話の要約:\n${existingSummary}\n\n追加された会話:\n${convo}\n\n上記2つを統合した最新の要約を作成してください。`
    : `次の会話を要約してください:\n${convo}`

  return { system: SUMMARY_SYSTEM, messages: [{ role: 'user', content: userText }] }
}

export interface SummarizeThreadParams {
  channelId: string
  threadTs: string
  personId: string
  model: string
  /** 現在の thread_summary（累積要約の入力）。person 不一致時は呼び出し側で null を渡す想定 */
  existingSummary: string | null
  /** 現在の summary_message_count（古い方から要約済みの件数） */
  summarizedCount: number
}

export interface SummarizeThreadResult {
  summarized: boolean
  usage?: LlmUsage
  newCount?: number
}

/**
 * 必要なら（未要約しっぽが閾値到達）古い履歴を累積要約して thread_summary / summary_message_count を更新する。
 * 返信送信後に呼ぶ想定（コスト発生。失敗時は呼び出し側が握りつぶす, BR-20-04）。
 */
export async function summarizeThread(
  db: ServerDb,
  llm: LlmClient,
  params: SummarizeThreadParams,
): Promise<SummarizeThreadResult> {
  const total = await countThreadMessages(db, params.channelId, params.threadTs, params.personId)
  const plan = planSummary(total, params.summarizedCount)
  if (!plan) return { summarized: false }

  const oldMessages = await loadMessageRange(
    db,
    params.channelId,
    params.threadTs,
    params.personId,
    plan.offset,
    plan.limit,
  )
  if (oldMessages.length === 0) return { summarized: false }

  const { system, messages } = buildSummaryPrompt(params.existingSummary, oldMessages)
  const result = await llm.generate({
    system,
    messages,
    model: params.model,
    maxTokens: SUMMARY_MAX_TOKENS,
  })

  // person_id も条件に含め、再割当てで別生徒のセッションを書き換えない（BR-05-11）
  const { error } = await db
    .from('slack_thread_sessions')
    .update({ thread_summary: result.text, summary_message_count: plan.newCount })
    .eq('slack_channel_id', params.channelId)
    .eq('thread_ts', params.threadTs)
    .eq('person_id', params.personId)
  if (error) throw error

  return { summarized: true, usage: result.usage, newCount: plan.newCount }
}
