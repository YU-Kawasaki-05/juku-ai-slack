/** @file
 * 検証: OpenAI 互換アダプタのエラーマッピング・リトライ設定・打ち切り検出
 * @verifies FR-05, AI_TIMEOUT / AI_RATE_LIMITED / AI_RESPONSE_FAILED の区別, A-10, A-15
 */
import { describe, it, expect, vi } from 'vitest'

/** OpenAI コンストラクタに渡される設定と、生成された create スパイを覗くためのスパイ */
const spy = vi.hoisted(() => ({
  openAiOptions: [] as Record<string, unknown>[],
  creates: [] as import('vitest').Mock[],
}))
vi.mock('openai', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: new (o: unknown) => unknown }
  const Real = actual.default
  // 実クライアントは jsdom 環境で生成を拒否する（ブラウザ検出）ため、設定の記録だけを行う代替を返す。
  // 静的メンバ（APIConnectionTimeoutError 等）はプロトタイプチェーンで実物を引き継ぐ
  class SpiedOpenAI {
    chat = { completions: { create: vi.fn() } }
    constructor(options: Record<string, unknown>) {
      spy.openAiOptions.push(options)
      spy.creates.push(this.chat.completions.create)
    }
  }
  Object.setPrototypeOf(SpiedOpenAI, Real)
  return { ...actual, default: SpiedOpenAI }
})

import OpenAI from 'openai'
import {
  mapOpenAiError,
  isTruncated,
  createOpenAiCompatibleClient,
  preferredTokenParam,
  isUnsupportedTokenParam,
} from './openaiCompatibleClient'

const capturedOpenAiOptions = spy.openAiOptions

/** アダプタを 1 つ作り、その内部 create スパイを返す */
function makeClient() {
  const client = createOpenAiCompatibleClient({ apiKey: 'k', baseURL: 'https://example.test/v1' })
  return { client, create: spy.creates.at(-1)! }
}

/** OpenAI が返す「上限パラメータが非対応」の 400 を模す */
function unsupportedParamError(param: string) {
  return Object.assign(
    new Error(`Unsupported parameter: '${param}' is not supported with this model.`),
    {
      status: 400,
      error: {
        message: `Unsupported parameter: '${param}' is not supported with this model. Use 'max_completion_tokens' instead.`,
        param,
        type: 'invalid_request_error',
        code: 'unsupported_parameter',
      },
    },
  )
}

const okResponse = {
  choices: [{ message: { content: '疎通OK' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
  model: 'served-model',
}

describe('mapOpenAiError', () => {
  it('タイムアウト（APIConnectionTimeoutError）→ AI_TIMEOUT', () => {
    const err = new OpenAI.APIConnectionTimeoutError({ message: 'timeout' })
    expect(mapOpenAiError(err).message).toBeDefined()
    expect((mapOpenAiError(err) as { code?: string }).code).toBe('AI_TIMEOUT')
  })

  it('status 429 → AI_RATE_LIMITED', () => {
    expect((mapOpenAiError({ status: 429 }) as { code?: string }).code).toBe('AI_RATE_LIMITED')
  })

  it('status 408 → AI_TIMEOUT', () => {
    expect((mapOpenAiError({ status: 408 }) as { code?: string }).code).toBe('AI_TIMEOUT')
  })

  it('その他 → AI_RESPONSE_FAILED', () => {
    expect((mapOpenAiError({ status: 500 }) as { code?: string }).code).toBe('AI_RESPONSE_FAILED')
    expect((mapOpenAiError(new Error('x')) as { code?: string }).code).toBe('AI_RESPONSE_FAILED')
  })
})

describe('isTruncated（A-15 / G-3）', () => {
  it("finish_reason='length' を打ち切りとみなす", () => {
    expect(isTruncated({ finish_reason: 'length' })).toBe(true)
  })
  it("Anthropic 互換ゲートウェイの 'max_tokens' も打ち切り扱い", () => {
    expect(isTruncated({ finish_reason: 'max_tokens' })).toBe(true)
  })
  it('stop / 未指定は打ち切りでない', () => {
    expect(isTruncated({ finish_reason: 'stop' })).toBe(false)
    expect(isTruncated({})).toBe(false)
    expect(isTruncated(undefined)).toBe(false)
  })
})

describe('createOpenAiCompatibleClient（A-10）', () => {
  it('SDK 内蔵リトライを無効化する（ジョブ側 3 attempts との掛け算で 9 回呼ぶのを防ぐ）', () => {
    const client = createOpenAiCompatibleClient({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
    }) as unknown as { generate: unknown }
    expect(client.generate).toBeTypeOf('function')

    // アダプタが内部で生成する OpenAI インスタンスの設定を確認する
    const inner = capturedOpenAiOptions.at(-1)
    expect(inner?.maxRetries).toBe(0)
    expect(inner?.timeout).toBe(60_000)
  })
})

describe('preferredTokenParam（上限パラメータ名の推測）', () => {
  it('GPT-5 系 / o シリーズは max_completion_tokens', () => {
    expect(preferredTokenParam('gpt-5.6-luna')).toBe('max_completion_tokens')
    expect(preferredTokenParam('gpt-5.6-terra')).toBe('max_completion_tokens')
    expect(preferredTokenParam('gpt-5-mini')).toBe('max_completion_tokens')
    expect(preferredTokenParam('o3')).toBe('max_completion_tokens')
  })

  it('OpenRouter の provider/model 形式でもサフィックスで判定できる', () => {
    expect(preferredTokenParam('openai/gpt-5.6-luna')).toBe('max_completion_tokens')
    expect(preferredTokenParam('deepseek/deepseek-chat')).toBe('max_tokens')
  })

  it('それ以外は広く通る max_tokens を既定にする（未知パラメータを黙って無視されると上限が効かなくなる）', () => {
    expect(preferredTokenParam('gpt-4o-mini')).toBe('max_tokens')
    expect(preferredTokenParam('gpt-4o')).toBe('max_tokens')
    expect(preferredTokenParam('deepseek-chat')).toBe('max_tokens')
  })
})

describe('isUnsupportedTokenParam', () => {
  it('400 で param が名指しされていれば true', () => {
    expect(isUnsupportedTokenParam(unsupportedParamError('max_tokens'), 'max_tokens')).toBe(true)
  })

  it('param フィールドが無くてもメッセージ本文で判定できる', () => {
    const err = Object.assign(new Error("Unsupported parameter: 'max_tokens' is not supported"), {
      status: 400,
    })
    expect(isUnsupportedTokenParam(err, 'max_tokens')).toBe(true)
  })

  it('送っていない側のパラメータ名では false（誤った入れ替えを防ぐ）', () => {
    expect(
      isUnsupportedTokenParam(unsupportedParamError('max_tokens'), 'max_completion_tokens'),
    ).toBe(false)
  })

  it('別理由の 400 や 429 では false（二重課金を防ぐ）', () => {
    const other = Object.assign(new Error('Invalid image'), {
      status: 400,
      error: { message: 'Invalid image', code: 'image_parse_error' },
    })
    expect(isUnsupportedTokenParam(other, 'max_tokens')).toBe(false)
    expect(isUnsupportedTokenParam({ status: 429 }, 'max_tokens')).toBe(false)
  })
})

describe('generate の上限パラメータ切り替え', () => {
  it('GPT-5 系には最初から max_completion_tokens を送る（無駄な往復をしない）', async () => {
    const { client, create } = makeClient()
    create.mockResolvedValueOnce(okResponse)

    await client.generate({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'q' }], maxTokens: 1200 })

    expect(create).toHaveBeenCalledTimes(1)
    const body = create.mock.calls[0][0] as Record<string, unknown>
    expect(body.max_completion_tokens).toBe(1200)
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('推測が外れたら 1 回だけ入れ替えて再試行し、以降はキャッシュを使う', async () => {
    const { client, create } = makeClient()
    // 推測が max_tokens になるモデル名だが、実際は max_completion_tokens しか受けない
    const model = 'legacy-looking-but-new-model'
    create
      .mockRejectedValueOnce(unsupportedParamError('max_tokens'))
      .mockResolvedValueOnce(okResponse)

    const first = await client.generate({ model, messages: [{ role: 'user', content: 'q' }], maxTokens: 800 })
    expect(first.text).toBe('疎通OK')
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0]).toHaveProperty('max_tokens', 800)
    expect(create.mock.calls[1][0]).toHaveProperty('max_completion_tokens', 800)

    // 2 回目は学習済みなので 1 回で済む
    create.mockResolvedValueOnce(okResponse)
    await client.generate({ model, messages: [{ role: 'user', content: 'q2' }], maxTokens: 800 })
    expect(create).toHaveBeenCalledTimes(3)
    expect(create.mock.calls[2][0]).toHaveProperty('max_completion_tokens', 800)
  })

  it('別理由の 400 では再試行せずエラーにする（二重課金を防ぐ）', async () => {
    const { client, create } = makeClient()
    create.mockRejectedValueOnce(
      Object.assign(new Error('Invalid image'), {
        status: 400,
        error: { message: 'Invalid image', code: 'image_parse_error' },
      }),
    )

    await expect(
      client.generate({ model: 'some-other-model', messages: [{ role: 'user', content: 'q' }], maxTokens: 100 }),
    ).rejects.toMatchObject({ code: 'AI_RESPONSE_FAILED' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('maxTokens 未指定なら上限パラメータを送らない', async () => {
    const { client, create } = makeClient()
    create.mockResolvedValueOnce(okResponse)

    await client.generate({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'q' }] })

    const body = create.mock.calls[0][0] as Record<string, unknown>
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('max_completion_tokens')
  })
})
