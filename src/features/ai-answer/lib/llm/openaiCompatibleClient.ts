/** @file
 * 機能: OpenAI 互換 Chat Completions API を叩く LlmClient アダプタ
 *       （OpenRouter / DeepSeek / OpenAI など baseURL 切替で共通利用）
 * 入力: apiKey, baseURL / generate(params)
 * 出力: LlmResult
 * 例外: レート制限→AiRateLimitedError / タイムアウト→AiTimeoutError / その他→AiResponseFailedError
 * 依存: openai npm SDK
 * 副作用: 外部 LLM API 呼び出し
 * セキュリティ: API キーはサーバー環境変数のみ。応答をそのまま Slack に出す前に呼び出し側で整形
 * @implements FR-05
 */
import OpenAI from 'openai'
import {
  AiRateLimitedError,
  AiTimeoutError,
  AiResponseFailedError,
} from '@shared/lib/errors/AppError'
import type { LlmClient, LlmGenerateParams, LlmResult, LlmMessage } from './types'

export interface OpenAiCompatibleOptions {
  apiKey: string
  baseURL: string
  /** リクエストタイムアウト（ミリ秒）。既定 60 秒 */
  timeoutMs?: number
}

type OpenAiContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >

function toOpenAiContent(content: LlmMessage['content']): OpenAiContent {
  if (typeof content === 'string') return content
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : { type: 'image_url' as const, image_url: { url: part.dataUrl } },
  )
}

function toChatMessages(system: string | undefined, messages: LlmMessage[]) {
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: OpenAiContent }> = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) out.push({ role: m.role, content: toOpenAiContent(m.content) })
  return out
}

/** 出力上限を指定するリクエストパラメータ名。モデルによって排他的（両方送るとエラーになる） */
type TokenParam = 'max_tokens' | 'max_completion_tokens'

/**
 * モデルごとに「通った上限パラメータ名」を記憶する（プロセス内キャッシュ）。
 * Vercel の関数はコールドスタートごとに空になるが、その場合でも
 * preferredTokenParam の推測が当たれば無駄な往復は発生しない。
 */
const tokenParamByModel = new Map<string, TokenParam>()

/**
 * 上限パラメータ名の初期推測。
 *
 * OpenAI の GPT-5 系 / o シリーズは `max_tokens` を 400 で拒否し `max_completion_tokens` を要求する
 * （実測: gpt-5.6-luna / gpt-5.6-terra とも "Unsupported parameter: 'max_tokens'"）。
 * 一方 gpt-4o 系や OpenAI 互換ゲートウェイ経由の非 OpenAI モデルは `max_tokens` しか知らないことがあり、
 * 知らないパラメータを黙って無視する実装だと**出力上限が効かなくなる**（エラーも出ない）。
 * そのため「広く通る max_tokens」を既定にし、新世代 OpenAI モデルだけ例外にする。
 *
 * 推測が外れても generate() が 400 を見て入れ替えるので、ここは当たれば往復が減るだけの最適化。
 */
export function preferredTokenParam(model: string): TokenParam {
  // OpenRouter の `provider/model` 形式でも判定できるようサフィックスを見る
  const name = model.slice(model.lastIndexOf('/') + 1)
  return /^(gpt-5|o[1-9])/.test(name) ? 'max_completion_tokens' : 'max_tokens'
}

/**
 * その 400 が「いま送った上限パラメータが非対応」を意味するか。
 * 単なる 400（不正なメッセージ形式など）で再試行して二重課金しないよう、
 * パラメータ名が名指しされていることまで確認する。
 */
export function isUnsupportedTokenParam(err: unknown, sent: TokenParam): boolean {
  const e = err as {
    status?: number
    message?: string
    error?: { message?: string; param?: string; code?: string }
  }
  if (e?.status !== 400) return false
  if (e.error?.param === sent) return true

  // 本文判定は「名指しされている形」だけを見る。単純な部分一致にすると
  // 実メッセージ "Unsupported parameter: 'max_tokens' ... Use 'max_completion_tokens' instead."
  // の**提案側**を拾って、送っていない側でも true になってしまう
  const message = `${e.error?.message ?? ''} ${e.message ?? ''}`
  return (
    message.includes(`parameter: '${sent}'`) ||
    message.includes(`'${sent}' is not supported`) ||
    message.includes(`'${sent}' is unsupported`)
  )
}

export function createOpenAiCompatibleClient(opts: OpenAiCompatibleOptions): LlmClient {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    timeout: opts.timeoutMs ?? 60_000,
    // A-10: SDK 既定の maxRetries=2 とジョブ側の 3 attempts が掛け算になり、
    // 最悪 9 回の LLM 呼び出し（最長 9 分）になる。リトライはジョブ側に一本化する
    maxRetries: 0,
  })

  return {
    async generate(params: LlmGenerateParams): Promise<LlmResult> {
      const messages = toChatMessages(
        params.system,
        params.messages,
      ) as OpenAI.Chat.Completions.ChatCompletionMessageParam[]

      const send = (tokenParam: TokenParam) =>
        client.chat.completions.create({
          model: params.model,
          messages,
          // 上限パラメータ名はモデルによって排他（下記 preferredTokenParam のコメント参照）
          ...(params.maxTokens === undefined ? {} : { [tokenParam]: params.maxTokens }),
          temperature: params.temperature,
        })

      try {
        const first = tokenParamByModel.get(params.model) ?? preferredTokenParam(params.model)
        let res: Awaited<ReturnType<typeof send>>
        try {
          res = await send(first)
        } catch (err) {
          // 推測が外れた場合だけ入れ替えて 1 回だけ再試行し、結果を記憶する。
          // これをやらないとモデルを差し替えた瞬間に全質問が 400 で落ちる（発生時にコード修正が必要になる）
          if (!isUnsupportedTokenParam(err, first)) throw err
          const alt: TokenParam =
            first === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
          console.warn(
            `[llm] ${params.model} は ${first} 非対応。${alt} で再試行する（以降はキャッシュ）`,
          )
          res = await send(alt)
          tokenParamByModel.set(params.model, alt)
        }

        const choice = res.choices[0]
        const text = choice?.message?.content ?? ''
        // 空応答をそのまま Slack に投げると no_text で失敗し無応答になる → 明示エラーにする
        if (!text.trim()) {
          throw new AiResponseFailedError('LLM から空の応答が返りました')
        }
        return {
          text,
          usage: {
            inputTokens: res.usage?.prompt_tokens ?? 0,
            outputTokens: res.usage?.completion_tokens ?? 0,
          },
          model: res.model ?? params.model,
          // A-15 / G-3: 出力上限での打ち切りを呼び出し側に伝える
          truncated: isTruncated(choice),
        }
      } catch (err) {
        throw mapOpenAiError(err)
      }
    },
  }
}

/**
 * 出力トークン上限で打ち切られたか（A-15 / G-3）。
 * OpenAI 互換プロバイダは finish_reason に 'length'（Anthropic 互換ゲートウェイでは
 * 'max_tokens' を返す実装もある）を入れる。
 */
export function isTruncated(choice: { finish_reason?: string | null } | undefined): boolean {
  const reason = choice?.finish_reason
  return reason === 'length' || reason === 'max_tokens'
}

export function mapOpenAiError(err: unknown): Error {
  // 既に AppError（空応答等）ならそのまま
  if (
    err instanceof AiResponseFailedError ||
    err instanceof AiRateLimitedError ||
    err instanceof AiTimeoutError
  ) {
    return err
  }
  // タイムアウトは name/status が付かない実装があるため instanceof で判定（openai v6 で確認済み）
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AiTimeoutError()
  const status = (err as { status?: number })?.status
  if (status === 429) return new AiRateLimitedError(err)
  if (status === 408) return new AiTimeoutError()
  return new AiResponseFailedError(err)
}
