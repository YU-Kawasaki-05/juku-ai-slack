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

/**
 * レート制限（AI_RATE_LIMITED）専用のベース待機時間（ミリ秒）。A-11。
 * 500ms/1000ms では 429 のウィンドウを抜けられず 3 回とも無駄打ちになるため、
 * 5秒 → 15秒（× JOB_RETRY_RATE_LIMIT_FACTOR）と長めに待つ。
 */
export const JOB_RETRY_RATE_LIMIT_BASE_DELAY_MS = 5_000
/** レート制限バックオフの倍率（5s → 15s → 45s） */
export const JOB_RETRY_RATE_LIMIT_FACTOR = 3

/** Sprint 1 の暫定返信文言（Sprint 2 で AI 回答に置換） */
export const SPRINT1_ACK_REPLY = '受け付けました（テスト返信）🙌'

// --- 滞留ジョブの回収・保持期間（A-1 後半 / A-14。DEC-13 により Cron は使わない）---

/**
 * processing のまま放置されたジョブを failed 扱いにするまでの分数。
 * route.ts の maxDuration=300（5分）+ リトライ待機を吸収できる余裕を取る。
 */
export const JOB_PROCESSING_TIMEOUT_MIN = 10
/**
 * pending のまま放置されたジョブ（after() 自体が走らなかった孤児）を failed 扱いにするまでの分数。
 * enqueue 直後に after() が走る設計なので、これを超える pending は実行機会を失っている。
 */
export const JOB_PENDING_TIMEOUT_MIN = 15
/** slack_event_receipts の保持日数（運用設計 1.1: 30日で定期削除） */
export const RECEIPT_RETENTION_DAYS = 30
/** jobs（完了系）の保持日数（運用設計 1.1: 7日で定期削除） */
export const JOB_RETENTION_DAYS = 7

// --- 暴走防止のレート制限（F-2 / 運用設計 3.4）---

/**
 * person_id 単位の質問回数の上限（直近1時間）。運用設計 3.4。
 * LLM 呼び出しの手前で判定し、超過分は課金を発生させずに定型文で返す。
 */
export const RATE_LIMIT_QUESTIONS_PER_HOUR = 10
/** レート制限の集計ウィンドウ（ミリ秒） */
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

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

// --- スレッド長期要約（FR-20 / BR-20-01, BR-03-04）---

/**
 * 未要約の「しっぽ」がこの件数に達したら古い分を要約する（10往復 = user/assistant 各1行 × 10）。
 * 判定は「総数 − 要約済み件数 ≥ この値」の単調条件（件数のパリティずれに強い）。
 */
export const SUMMARY_TRIGGER_MESSAGES = 20
/** 要約せずプロンプトにそのまま残す直近メッセージ数（5往復ぶん）。要約は「これより古い分」を対象にする */
export const SUMMARY_KEEP_RECENT_MESSAGES = 10
/** 1ターンでプロンプトに載せる履歴（未要約しっぽ）の安全上限。しっぽは通常この未満に保たれる */
export const SUMMARY_TAIL_MAX_MESSAGES = 30
/** 要約生成の最大出力トークン */
export const SUMMARY_MAX_TOKENS = 400

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

// --- 画像添付（FR-06）---

/** 対応画像 MIME（jpg=image/jpeg）。BR-06-01 */
export const SUPPORTED_IMAGE_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
/** 1枚あたりの最大バイト数（20MB）。BR-06-03 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** 1メッセージで処理する最大枚数。BR-06-02 */
export const MAX_IMAGES_PER_MESSAGE = 3
/**
 * 1メッセージで LLM に送る画像の合計バイト上限（8MB）。
 * base64 化すると約 1.33 倍になるため、枚数上限だけでは Vision API の受付上限を超える。
 */
export const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024
/** Supabase Storage の添付バケット名 */
export const ATTACHMENTS_BUCKET = 'attachments'

// --- RAG（FR-10）---

/** embedding 次元（migration 005/020 の vector(1536) と一致させること） */
export const EMBEDDING_DIM = 1536
/** 検索で返すチャンク数の既定（BR: top_k 3〜8） */
export const RAG_TOP_K = 5
/** 類似度の下限（BR-10-06） */
export const RAG_SIMILARITY_THRESHOLD = 0.7
/** 1チャンクの最大文字数（BR-10-02: 200〜800 tokens 目安。日本語 ~1tok/字 を考慮） */
export const RAG_CHUNK_MAX_CHARS = 1000

export interface ModelPrice {
  inputPerM: number
  outputPerM: number
}

// 単価の実体。ベンダー直呼びと OpenRouter 形式（`provider/model`）で同じ値を共有し、
// 片方だけ更新して食い違うのを防ぐ
const PRICE_CLAUDE_HAIKU_4_5: ModelPrice = { inputPerM: 1.0, outputPerM: 5.0 }
const PRICE_CLAUDE_SONNET_4_6: ModelPrice = { inputPerM: 3.0, outputPerM: 15.0 }
const PRICE_GPT_4O_MINI: ModelPrice = { inputPerM: 0.15, outputPerM: 0.6 }
const PRICE_GPT_4O: ModelPrice = { inputPerM: 2.5, outputPerM: 10.0 }
const PRICE_DEEPSEEK_CHAT: ModelPrice = { inputPerM: 0.27, outputPerM: 1.1 }

/**
 * モデル別の料金（USD / 100万トークン）。プロバイダ非依存。
 * ここに無いモデルは cost=0 で記録される（トークン数は常に記録される）。
 * 単価は各プロバイダの公表値に合わせて更新すること。
 *
 * キーは「ベンダー直呼びの素の名前」と「OpenRouter 形式（`provider/model`）」の両方を登録する。
 * 未登録の `provider/model` も calculateCost が `/` 以降のサフィックスで再照合するため、
 * 素の名前さえ登録されていれば 0 円表示にはならない（E-3）。
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Anthropic（現行世代の目安）
  'claude-haiku-4-5': PRICE_CLAUDE_HAIKU_4_5,
  'anthropic/claude-haiku-4-5': PRICE_CLAUDE_HAIKU_4_5,
  'claude-sonnet-4-6': PRICE_CLAUDE_SONNET_4_6,
  'anthropic/claude-sonnet-4-6': PRICE_CLAUDE_SONNET_4_6,
  // OpenAI
  'gpt-4o-mini': PRICE_GPT_4O_MINI,
  'openai/gpt-4o-mini': PRICE_GPT_4O_MINI,
  'gpt-4o': PRICE_GPT_4O,
  'openai/gpt-4o': PRICE_GPT_4O,
  // DeepSeek
  'deepseek-chat': PRICE_DEEPSEEK_CHAT,
  'deepseek/deepseek-chat': PRICE_DEEPSEEK_CHAT,
}

/**
 * MODEL_PRICING からモデルの単価を引く。完全一致 → `/` 以降のサフィックスの順で照合する。
 * 未登録なら undefined（呼び出し側で「単価未登録」として扱う）。
 */
export function findModelPrice(model: string): ModelPrice | undefined {
  // Record の索引はプロトタイプ由来のキー（constructor 等）も拾うため hasOwn で防ぐ
  if (Object.hasOwn(MODEL_PRICING, model)) return MODEL_PRICING[model]

  const slash = model.lastIndexOf('/')
  if (slash === -1) return undefined
  const suffix = model.slice(slash + 1)
  return Object.hasOwn(MODEL_PRICING, suffix) ? MODEL_PRICING[suffix] : undefined
}
