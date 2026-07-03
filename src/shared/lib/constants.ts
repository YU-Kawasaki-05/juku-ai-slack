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
