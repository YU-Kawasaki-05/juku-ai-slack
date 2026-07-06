/** @file
 * 機能: 受信メッセージに Bot が反応すべきか判定する純粋関数
 * 入力: ShouldReactInput（イベント属性 + DB 参照結果）
 * 出力: ReactionDecision（ignore / process / channel_not_bound）
 * 例外: なし
 * 依存: なし（純粋関数。DB 参照は呼び出し側で行い結果を注入）
 * セキュリティ: channel_id ベースの binding 状態のみで判定。channel_name は使わない（BR-07-01）
 * @implements FR-02, AC-02-01, AC-02-02, AC-02-03, AC-02-04, AC-02-05, AC-02-06
 */
import type { ReactionDecision, ShouldReactInput } from '../types'

/**
 * 反応制御の判定。
 *
 * 優先順位:
 * 1. Bot 自身のメッセージ → ignore（BR-02-01）
 * 2. subtype 付き（message_changed 等）→ ignore（BR-02-02）。ただし file_share は画像添付なので許容
 * 3. テキストも対応画像もなし → ignore（BR-02-06 / BR-06-08）
 * 4. スレッド内返信:
 *    - セッション登録済み → 反応対象（BR-02-04, AC-02-03）。ただし binding が無効なら channel_not_bound
 *    - 未登録 + メンションなし → ignore（AC-02-04）
 *    - 未登録 + メンションあり → 新規扱い（binding 判定へ）
 * 5. チャンネル直下:
 *    - メンションなし → ignore（BR-02-03, AC-02-02）※スタッフ雑談に反応しない
 *    - メンションあり → binding 判定へ
 * 6. binding: active → process / それ以外 → channel_not_bound（BR-02-05, BR-07-03, AC-02-06）
 */
export function shouldReact(input: ShouldReactInput): ReactionDecision {
  if (input.hasBotId) {
    return { action: 'ignore', reason: 'bot_message' }
  }

  // file_share は画像添付を伴う通常メッセージなので許容。それ以外の subtype は無視
  if (input.subtype && input.subtype !== 'file_share') {
    return { action: 'ignore', reason: `subtype:${input.subtype}` }
  }

  const hasText = typeof input.text === 'string' && input.text.trim().length > 0
  if (!hasText && !input.hasImage) {
    return { action: 'ignore', reason: 'no_content' }
  }

  // 登録済みスレッド内はメンション不要で反応（AC-02-03）
  const isRegisteredThread = input.isThreadReply && input.sessionExists

  if (!isRegisteredThread) {
    // 未登録スレッド / チャンネル直下ともメンションが必須
    if (!input.hasMention) {
      return {
        action: 'ignore',
        reason: input.isThreadReply ? 'unregistered_thread_no_mention' : 'channel_no_mention',
      }
    }
  }

  // ここに来る = 反応候補。紐付け状態を確認（BR-02-05 / BR-07-03）
  if (input.bindingStatus !== 'active') {
    return { action: 'channel_not_bound' }
  }

  return { action: 'process' }
}
