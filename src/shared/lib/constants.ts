/** @file
 * 機能: プロジェクト共通の定数（マジックナンバー排除）
 * 依存: なし
 * @implements -
 */

/** Slack 署名のバージョンプレフィックス */
export const SLACK_SIGNATURE_VERSION = 'v0'

/** リプレイ攻撃防止: 許容するタイムスタンプのずれ（秒）。BR-01-02 */
export const SLACK_TIMESTAMP_TOLERANCE_SEC = 300

/** AI 処理中を示すリアクション名（:thinking_face: = 🤔）。BR-01-06 */
export const THINKING_REACTION = 'thinking_face'

/** ジョブ種別: Slack メッセージ処理。FR-04 */
export const JOB_TYPE_PROCESS_MESSAGE = 'process_slack_message'

/** ジョブのデフォルト最大試行回数。BR-04-04 */
export const DEFAULT_MAX_ATTEMPTS = 3

/** リトライのベース待機時間（ミリ秒）。指数バックオフの基準 */
export const JOB_RETRY_BASE_DELAY_MS = 500

/** Sprint 1 の暫定返信文言（Sprint 2 で AI 回答に置換） */
export const SPRINT1_ACK_REPLY = '受け付けました（テスト返信）🙌'

// --- AI 回答（FR-05 / DEC-23）---

/** P(mastery) 未取得トピックのデフォルト（P(L0)）。BR-05-05 */
export const P_MASTERY_DEFAULT = 0.2

/** direct モードの上限（P < 0.3）。DEC-23 */
export const P_MASTERY_DIRECT_MAX = 0.3

/** socratic モードの上限（0.3 ≤ P < 0.8）。P ≥ 0.8 は confirmation。DEC-23 */
export const P_MASTERY_SOCRATIC_MAX = 0.8

/** Tutor 応答の最大出力トークン */
export const TUTOR_MAX_TOKENS = 1200

/** 質問本文の最大文字数（入力コスト暴走防止）。超過は TOKEN_BUDGET_EXCEEDED */
export const MAX_QUESTION_CHARS = 6000

// --- BKT 知識追跡（FR-23 / DEC-24）---

/** BKT 学習率 P(T) */
export const BKT_P_LEARN = 0.15
/** BKT ゲス率 P(G) */
export const BKT_P_GUESS = 0.2
/** BKT スリップ率 P(S) */
export const BKT_P_SLIP = 0.1
/** 習得済み判定の P(mastery) 閾値 */
export const BKT_MASTERED_THRESHOLD = 0.95
/** 習得済み判定に必要な連続正解数 */
export const BKT_MASTERED_STREAK = 3
/** Evaluator の確信度がこの値未満なら DB 書き込みしない（BR-23-03, AC-23-07） */
export const EVAL_MIN_CONFIDENCE = 0.5
/** forgetting decay を適用する最小経過日数（BR-23-05） */
export const FORGETTING_DECAY_MIN_DAYS = 14
/** トピック特定不能を表す ID（この場合 BKT 更新をスキップ） */
export const UNKNOWN_TOPIC = 'unknown'

/**
 * モデル別の料金（USD / 100万トークン）。プロバイダ非依存。
 * ここに無いモデルは cost=0 で記録される（トークン数は常に記録される）。
 * 単価は各プロバイダの公表値に合わせて更新すること。
 */
export const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  // Anthropic（現行世代の目安）
  'claude-haiku-4-5': { inputPerM: 1.0, outputPerM: 5.0 },
  'claude-sonnet-4-6': { inputPerM: 3.0, outputPerM: 15.0 },
  // OpenAI
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10.0 },
  // DeepSeek
  'deepseek-chat': { inputPerM: 0.27, outputPerM: 1.1 },
}
