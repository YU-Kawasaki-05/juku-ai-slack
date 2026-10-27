// クライアントバンドルへの誤取り込みをビルド時に検知する（シークレット集約ファイル）
import 'server-only'
import { z } from 'zod'

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_BOT_USER_ID: z.string().min(1),
  // 管理画面のエラー詳細から Slack スレッドを開くリンク用（任意。未設定ならリンク非表示）
  SLACK_WORKSPACE_URL: z.string().url().optional(),
  // 運用アラートの通知先チャンネル ID（DEC-15: kill_switch の停止・再開通知）。
  // 任意にしているのは、未設定で env のパースが落ちると Slack 連携ごと 500 になるため。
  // 未設定時は通知をスキップして console.warn のみ（切替操作自体は成功する）
  SLACK_ALERTS_CHANNEL_ID: z.string().min(1).optional(),
  // Slack Web API の向き先差し替え（受け入れテストのモックサーバー用）。
  // セキュリティ: Bot Token の流出経路にしないため、ループバック宛て以外は client.ts 側で拒否する。
  SLACK_API_BASE_URL: z.string().url().optional(),

  // LLM プロバイダ非依存設定（OpenAI 互換: OpenRouter / DeepSeek / OpenAI など）。
  // 実行時に LLM を呼ぶ箇所で存在チェックする（未確定でもビルド/他機能を壊さないため optional）
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_MODEL_DEFAULT: z.string().min(1).optional(),
  LLM_MODEL_COMPLEX: z.string().min(1).optional(),
  // Embedding（RAG）。プロバイダ非依存。未設定時は RAG をスキップ（チャンクなしで回答）
  EMBEDDING_API_KEY: z.string().min(1).optional(),
  EMBEDDING_BASE_URL: z.string().url().optional(),
  EMBEDDING_MODEL: z.string().min(1).optional(),
  // Anthropic 直アダプタを使う場合のみ
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // メール送信（Resend。月次レポートの送付に使う。FR-08）。未設定でも他の機能は動くため optional。
  // 形式検証（min(1) / email）を付けない: 空文字や `Name <addr>` 形式で env のパースが落ちると
  // Slack 連携ごと 500 になり、生徒の質問に答えられなくなる。検証は使う側（resolveMailConfig）で行い、
  // 不正なら「メール設定なし」として扱う（月次レポートの送信だけが止まる）
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),

  // 月次レポート（FR-08）。ここは「空文字でも env のパースを落とさない」ことを優先し、
  // min(1) や形式検証を付けない（他の変数と違い、Vercel で空のまま保存されても Slack 連携ごと
  // 500 にしない）。空・不正は使う側で「未設定」として扱い、画面とログに理由を出す。
  //   CRON_SECRET: /api/cron/monthly-reports の Bearer 認証。Vercel Cron が自動で付ける
  //   REPORT_EMAIL_TO: 月次レポートの送り先メールアドレス（カンマ区切りで複数可）
  //   VERCEL_PROJECT_PRODUCTION_URL: Vercel が自動で入れる本番ドメイン（メール本文の管理画面リンク用）
  CRON_SECRET: z.string().optional(),
  REPORT_EMAIL_TO: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  throw new Error(`Missing or invalid env vars: ${missing}`)
}

export const env = parsed.data
