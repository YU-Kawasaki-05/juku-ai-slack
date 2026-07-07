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

  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  throw new Error(`Missing or invalid env vars: ${missing}`)
}

export const env = parsed.data
