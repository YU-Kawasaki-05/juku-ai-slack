/** @file
 * 検証: 月次レポートの作成とメール送付のオーケストレーション
 *   前月の範囲・再開・手書きを上書きしない・0 件の生徒・メール設定なし・二重送信しない・
 *   送信失敗・人数と時間の上限・LLM 失敗・kill_switch・最後の試行
 * 備考: DB は実際にフィルタを評価するインメモリ実装（memoryDb）。LLM・Resend・Slack は関数のモック
 * @verifies FR-08, AC-08-01, BR-08-07, BR-08-02, DEC-16
 */
import { describe, it, expect, vi, type Mock } from 'vitest'
import { createMemoryDb } from '@/test/mocks/memoryDb'
import type { LlmClient } from '@features/ai-answer'
import {
  runMonthlyReports,
  TRUNCATED_REPORT_NOTICE,
  type RunDeps,
  type RunOptions,
} from './runMonthlyReports'

const MONTH = '2026-09'
const MONTH_DATE = '2026-09-01'

type Row = Record<string, unknown>

let msgSeq = 0
/** 生徒 1 人の質問 + AI の回答。at は UTC の ISO */
function qa(personId: string, at = '2026-09-10T03:00:00.000Z', q = '二次方程式の解き方は？'): Row[] {
  const ts = `${++msgSeq}`
  return [
    { id: `m${ts}a`, person_id: personId, role: 'user', text: q, created_at: at, slack_channel_id: 'C1', thread_ts: ts },
    { id: `m${ts}b`, person_id: personId, role: 'assistant', text: '解の公式を使います', created_at: at, slack_channel_id: 'C1', thread_ts: ts },
  ]
}

function person(id: string, name: string, extra: Row = {}): Row {
  return { id, name, display_name: null, status: 'active', created_at: `2026-01-0${id.slice(1) || 1}T00:00:00Z`, ...extra }
}

function makeDb(init: { persons?: Row[]; messages?: Row[]; reports?: Row[]; runs?: Row[]; usage?: Row[] }) {
  return createMemoryDb({
    tables: {
      persons: init.persons ?? [],
      slack_messages: init.messages ?? [],
      reports: init.reports ?? [],
      monthly_report_runs: init.runs ?? [],
      ai_usage_logs: init.usage ?? [],
    },
    unique: { reports: ['person_id', 'report_month'], monthly_report_runs: ['report_month'] },
    autoId: ['reports', 'ai_usage_logs', 'ai_error_logs'],
  })
}

const MAIL = { apiKey: 're_test', from: 'noreply@example.com', to: ['staff@example.com'] }

type MockedDeps = Omit<RunDeps, 'sendEmail' | 'alert' | 'isAiEnabled' | 'rebuildEmbeddings'> & {
  sendEmail: Mock<RunDeps['sendEmail']>
  alert: Mock<RunDeps['alert']>
  isAiEnabled: Mock<RunDeps['isAiEnabled']>
  rebuildEmbeddings: Mock<RunDeps['rebuildEmbeddings']>
}

function makeDeps(db: ReturnType<typeof makeDb>, over: Partial<RunDeps> = {}) {
  const llm = {
    generate: vi.fn(async () => ({
      text: '## 今月の質問の数と主な単元\n質問数: 1 件\n',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: 'm',
    })),
  } satisfies LlmClient
  const deps = {
    db,
    getLlm: () => llm,
    model: 'test-model',
    mail: MAIL,
    sendEmail: vi.fn<RunDeps['sendEmail']>(async () => ({ ok: true })),
    adminHost: 'juku.example.com',
    isAiEnabled: vi.fn<RunDeps['isAiEnabled']>(async () => true),
    rebuildEmbeddings: vi.fn<RunDeps['rebuildEmbeddings']>(async () => undefined),
    alert: vi.fn<RunDeps['alert']>(async () => undefined),
    now: () => Date.now(),
    ...over,
  } as MockedDeps
  return { deps, llm }
}

const run = (deps: RunDeps, opts: Partial<RunOptions> = {}) =>
  runMonthlyReports(deps, { month: MONTH, ...opts })

const sentMessage = (deps: MockedDeps, n = 0) =>
  deps.sendEmail.mock.calls[n][0] as {
    to: string[]
    subject: string
    text: string
    attachments: Array<{ filename: string; content: string }>
  }

describe('レポートの作成', () => {
  it('質問のある生徒ごとに ai_draft / generated_by_ai=true で保存し、質問 0 件の生徒は作らない', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A'), person('p2', '生徒B'), person('p3', '生徒C')],
      messages: [...qa('p1'), ...qa('p1', '2026-09-11T03:00:00.000Z'), ...qa('p3')],
    })
    const { deps, llm } = makeDeps(db)

    const r = await run(deps)

    expect(llm.generate).toHaveBeenCalledTimes(2)
    expect(r).toMatchObject({ students: 3, noQuestions: 1, generated: 2, failed: 0, remaining: 0 })
    const reports = db.__rows('reports')
    expect(reports).toHaveLength(2)
    expect(reports.map((x) => x.person_id).sort()).toEqual(['p1', 'p3'])
    for (const rep of reports) {
      expect(rep).toMatchObject({
        report_month: MONTH_DATE,
        status: 'ai_draft',
        generated_by_ai: true,
        title: '2026年9月 学習レポート',
      })
      expect(rep.body_markdown).toContain('質問数')
    }
    // 生徒の氏名はタイトルにも LLM への入力にも入らない
    expect(JSON.stringify(llm.generate.mock.calls)).not.toContain('生徒A')
    expect(reports.every((x) => !String(x.title).includes('生徒'))).toBe(true)
  })

  it('対象は日本時間の前月だけ（月初 0:00 JST を含み、翌月初 0:00 JST を含まない）', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A')],
      messages: [
        ...qa('p1', '2026-08-31T14:59:59.000Z', '8月末の質問'), // 8/31 23:59:59 JST = 対象外
        ...qa('p1', '2026-08-31T15:00:00.000Z', '9月頭の質問'), // 9/1 00:00 JST = 対象
        ...qa('p1', '2026-09-30T14:59:59.000Z', '9月末の質問'), // 9/30 23:59:59 JST = 対象
        ...qa('p1', '2026-09-30T15:00:00.000Z', '10月頭の質問'), // 10/1 00:00 JST = 対象外
      ],
    })
    const { deps, llm } = makeDeps(db)
    await run(deps)

    expect(llm.generate).toHaveBeenCalledTimes(1)
    const prompt = (llm.generate.mock.calls[0] as unknown as [{ messages: Array<{ content: string }> }])[0]
      .messages[0].content
    expect(prompt).toContain('質問数: 2 件')
    expect(prompt).toContain('9月頭の質問')
    expect(prompt).toContain('9月末の質問')
    expect(prompt).not.toContain('8月末の質問')
    expect(prompt).not.toContain('10月頭の質問')
  })

  it('退塾（inactive）の生徒は対象外', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A'), person('p2', '退塾生', { status: 'inactive' })],
      messages: [...qa('p1'), ...qa('p2')],
    })
    const { deps, llm } = makeDeps(db)
    const r = await run(deps)
    expect(llm.generate).toHaveBeenCalledTimes(1)
    expect(r.students).toBe(1)
  })

  it('person_id の無い発言は集計にも会話にも入らない', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A')],
      messages: [{ id: 'x', person_id: null, role: 'user', text: '誰の？', created_at: '2026-09-10T03:00:00.000Z' }],
    })
    const { deps, llm } = makeDeps(db)
    const r = await run(deps)
    expect(llm.generate).not.toHaveBeenCalled()
    expect(r.noQuestions).toBe(1)
  })

  it('利用量を記録する（会話に紐付かないので固定の channel / thread で識別）', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const { deps } = makeDeps(db)
    await run(deps)
    const usage = db.__rows('ai_usage_logs')
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({
      person_id: 'p1',
      slack_channel_id: 'monthly_report',
      thread_ts: MONTH,
      model: 'test-model',
      input_tokens: 100,
      output_tokens: 50,
    })
  })

  it('保存後に Embedding を作る。失敗してもレポートは残り、件数に数える', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A'), person('p2', '生徒B')], messages: [...qa('p1'), ...qa('p2')] })
    const rebuildEmbeddings = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('embed down'))
    const { deps } = makeDeps(db, { rebuildEmbeddings })
    const r = await run(deps)
    expect(rebuildEmbeddings).toHaveBeenCalledTimes(2)
    expect(r).toMatchObject({ generated: 2, failed: 0, embeddingFailed: 1 })
    expect(db.__rows('reports')).toHaveLength(2)
  })

  it('出力が上限で切れていたら注意書きを足して保存する', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const { deps } = makeDeps(db, {
      getLlm: () => ({
        generate: async () => ({
          text: '## 途中まで',
          usage: { inputTokens: 1, outputTokens: 1 },
          model: 'm',
          truncated: true,
        }),
      }),
    })
    await run(deps)
    expect(db.__rows('reports')[0].body_markdown).toBe(`## 途中まで${TRUNCATED_REPORT_NOTICE}`)
  })
})

describe('再開と上書き禁止', () => {
  it('AI 作成済みの生徒は飛ばし、残りだけ作る（再開）', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A'), person('p2', '生徒B')],
      messages: [...qa('p1'), ...qa('p2')],
      reports: [
        { id: 'r1', person_id: 'p1', report_month: MONTH_DATE, status: 'ai_draft', generated_by_ai: true, body_markdown: '前回の下書き' },
      ],
    })
    const { deps, llm } = makeDeps(db)
    const r = await run(deps)

    expect(llm.generate).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ generated: 1, alreadyGenerated: 1, remaining: 0 })
    expect(db.__rows('reports').find((x) => x.id === 'r1')?.body_markdown).toBe('前回の下書き')
    // 再開しても、メールには作成済みと今回分の両方を添付する
    expect(sentMessage(deps).attachments.map((a) => a.filename).sort()).toEqual([
      '2026-09_生徒A.md',
      '2026-09_生徒B.md',
    ])
  })

  it('スタッフが手で書いた前月分は上書きせず、LLM も呼ばない。メールには添付しない', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A'), person('p2', '生徒B')],
      messages: [...qa('p1'), ...qa('p2')],
      reports: [
        { id: 'r1', person_id: 'p1', report_month: MONTH_DATE, status: 'approved', generated_by_ai: false, body_markdown: '手書き本文' },
      ],
    })
    const { deps, llm } = makeDeps(db)
    const r = await run(deps)

    expect(llm.generate).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ generated: 1, manualExisting: 1, remaining: 0 })
    const manual = db.__rows('reports').find((x) => x.id === 'r1')
    expect(manual).toMatchObject({ body_markdown: '手書き本文', status: 'approved', generated_by_ai: false })
    const mail = sentMessage(deps)
    expect(mail.attachments.map((a) => a.filename)).toEqual(['2026-09_生徒B.md'])
    expect(mail.text).toContain('・生徒A: 1件（手書きのレポートがあるため添付なし）')
  })

  it('判定のあとにスタッフが同じ月を作った（一意制約違反）場合は上書きせず、失敗にも数えない', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    db.__inject('reports', 'insert', { code: '23505', message: 'duplicate key' })
    const { deps } = makeDeps(db)
    const r = await run(deps)
    expect(r).toMatchObject({ generated: 0, alreadyGenerated: 1, failed: 0, remaining: 0 })
    expect(db.__rows('ai_error_logs')).toHaveLength(0)
  })
})

describe('メール送付', () => {
  it('全員分が揃ったら 1 通だけ送る。生徒ごとの .md を添付し、0 件の生徒は「質問なし」と書く', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A'), person('p2', '生徒B')],
      messages: qa('p1'),
    })
    const { deps } = makeDeps(db)
    const r = await run(deps)

    expect(r.mail).toBe('sent')
    expect(deps.sendEmail).toHaveBeenCalledTimes(1)
    const mail = sentMessage(deps)
    expect(mail.to).toEqual(['staff@example.com'])
    expect(mail.subject).toContain('2026年9月分')
    expect(mail.attachments).toHaveLength(1)
    expect(mail.attachments[0].filename).toBe('2026-09_生徒A.md')
    expect(mail.attachments[0].content).toContain('質問数')
    expect(mail.text).toContain('・生徒B: 質問なし')
    expect(mail.text).toContain('https://juku.example.com/admin/reports?month=2026-09')
    // Resend の Idempotency-Key は月ごとに固定
    expect(deps.sendEmail.mock.calls[0][1]).toBe('monthly-report-2026-09')
    // 記録
    const record = db.__rows('monthly_report_runs')[0]
    expect(record.generated_at).toBeTruthy()
    expect(record.emailed_at).toBeTruthy()
    expect(record.email_error).toBeNull()
    expect(record.email_claimed_at).toBeNull()
  })

  it('表示名があれば添付名に使い、同名の生徒は _2 で区別する', async () => {
    const db = makeDb({
      persons: [
        person('p1', '本名A', { display_name: '同名' }),
        person('p2', '本名B', { display_name: '同名' }),
      ],
      messages: [...qa('p1'), ...qa('p2')],
    })
    const { deps } = makeDeps(db)
    await run(deps)
    expect(sentMessage(deps).attachments.map((a) => a.filename).sort()).toEqual([
      '2026-09_同名.md',
      '2026-09_同名_2.md',
    ])
  })

  it('同じ月を二重に送らない（2 回目は何も作らず、何も送らない）', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const { deps, llm } = makeDeps(db)

    const first = await run(deps)
    const second = await run(deps)
    const third = await run(deps, { finalAttempt: true })

    expect(first.mail).toBe('sent')
    expect(second.mail).toBe('already_sent')
    expect(third.mail).toBe('already_sent')
    expect(deps.sendEmail).toHaveBeenCalledTimes(1)
    expect(llm.generate).toHaveBeenCalledTimes(1)
    expect(db.__rows('reports')).toHaveLength(1)
  })

  it('別の実行が送信中（権利を取得済み）なら送らない', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A')],
      messages: qa('p1'),
      runs: [{ report_month: MONTH_DATE, email_claimed_at: new Date().toISOString() }],
    })
    const { deps } = makeDeps(db)
    const r = await run(deps)
    expect(r.mail).toBe('in_progress')
    expect(deps.sendEmail).not.toHaveBeenCalled()
  })

  it('送信中のまま異常終了した古い権利は引き継いで送る', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A')],
      messages: qa('p1'),
      runs: [{ report_month: MONTH_DATE, email_claimed_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() }],
    })
    const { deps } = makeDeps(db)
    const r = await run(deps)
    expect(r.mail).toBe('sent')
    expect(deps.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('同時に 2 つ実行しても送信は 1 回', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const { deps } = makeDeps(db)
    const [a, b] = await Promise.all([run(deps), run(deps)])
    expect(deps.sendEmail).toHaveBeenCalledTimes(1)
    expect([a.mail, b.mail].filter((m) => m === 'sent')).toHaveLength(1)
  })

  it('メール設定なしでも落ちず、作成だけ行う。設定後の実行で送る（再作成はしない）', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const noMail = makeDeps(db, { mail: null })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const first = await run(noMail.deps)
    expect(first.mail).toBe('not_configured')
    expect(first.generated).toBe(1)
    expect(noMail.deps.sendEmail).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('メール設定なし'))
    expect(db.__rows('monthly_report_runs')[0].emailed_at).toBeFalsy()
    expect(db.__rows('monthly_report_runs')[0].email_claimed_at).toBeFalsy()

    const withMail = makeDeps(db)
    const second = await run(withMail.deps)
    expect(second.mail).toBe('sent')
    expect(withMail.llm.generate).not.toHaveBeenCalled()
    expect(withMail.deps.sendEmail).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('送信に失敗したら記録して #alerts に知らせ、次の実行で再試行する', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const failing = makeDeps(db, {
      sendEmail: vi.fn(async () => ({ ok: false as const, error: 'Resend: HTTP 422 <!channel> bad from' })),
    })
    const first = await run(failing.deps)

    expect(first.mail).toBe('failed')
    expect(first.mailError).toContain('HTTP 422')
    const record = db.__rows('monthly_report_runs')[0]
    expect(record.emailed_at).toBeFalsy()
    expect(record.email_error).toContain('HTTP 422')
    expect(record.email_claimed_at).toBeNull()
    expect(failing.deps.alert).toHaveBeenCalledTimes(1)
    const alertText = (failing.deps.alert.mock.calls[0] as unknown as [string])[0]
    expect(alertText).toContain('2026年9月分')
    expect(alertText).toContain('HTTP 422')
    // Slack のメンション制御文字は無害化される
    expect(alertText).not.toContain('<!channel>')

    const ok = makeDeps(db)
    const second = await run(ok.deps)
    expect(second.mail).toBe('sent')
    expect(ok.deps.sendEmail).toHaveBeenCalledTimes(1)
    expect(db.__rows('monthly_report_runs')[0].email_error).toBeNull()
  })

  it('送信処理が例外を投げても失敗として扱う（権利を戻し、落ちない）', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const { deps } = makeDeps(db, {
      sendEmail: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const r = await run(deps)
    expect(r).toMatchObject({ mail: 'failed', mailError: 'boom' })
    expect(db.__rows('monthly_report_runs')[0].email_claimed_at).toBeNull()
  })

  it('アラートの送信が失敗しても結果は返る', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { deps } = makeDeps(db, {
      sendEmail: vi.fn(async () => ({ ok: false as const, error: 'x' })),
      alert: vi.fn(async () => {
        throw new Error('slack down')
      }),
    })
    const r = await run(deps)
    expect(r.mail).toBe('failed')
    err.mockRestore()
  })

  it('全員質問なしの月でも落ちず、レポートなしの案内メールを 1 通送る', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A'), person('p2', '生徒B')] })
    const { deps, llm } = makeDeps(db)
    const r = await run(deps)
    expect(llm.generate).not.toHaveBeenCalled()
    expect(r).toMatchObject({ noQuestions: 2, generated: 0, mail: 'sent' })
    expect(sentMessage(deps).attachments).toEqual([])
    expect(sentMessage(deps).text).toContain('・生徒A: 質問なし')
  })
})

describe('人数・時間の上限と失敗', () => {
  const five = () =>
    makeDb({
      persons: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) => person(id, `生徒${i}`)),
      messages: ['p1', 'p2', 'p3', 'p4', 'p5'].flatMap((id) => qa(id)),
    })

  it('1 回の人数上限で止まり、残りがある間はメールを送らない。次の実行で続きから作る', async () => {
    const db = five()
    const { deps, llm } = makeDeps(db)

    const first = await run(deps, { maxStudents: 2, concurrency: 1 })
    expect(first).toMatchObject({ generated: 2, remaining: 3, stoppedBy: 'limit', mail: 'deferred' })
    expect(llm.generate).toHaveBeenCalledTimes(2)
    expect(deps.sendEmail).not.toHaveBeenCalled()
    expect(db.__rows('monthly_report_runs')[0].generated_at).toBeFalsy()

    const second = await run(deps, { maxStudents: 2, concurrency: 1 })
    expect(second).toMatchObject({ generated: 2, alreadyGenerated: 2, remaining: 1, stoppedBy: 'limit', mail: 'deferred' })

    const third = await run(deps, { maxStudents: 2, concurrency: 1 })
    expect(third).toMatchObject({ generated: 1, alreadyGenerated: 4, remaining: 0, stoppedBy: null, mail: 'sent' })
    expect(llm.generate).toHaveBeenCalledTimes(5)
    expect(sentMessage(deps).attachments).toHaveLength(5)
    expect(db.__rows('monthly_report_runs')[0].generated_at).toBeTruthy()
  })

  it('同時実行しても人数上限を超えて着手しない', async () => {
    const db = five()
    const { deps, llm } = makeDeps(db)
    const r = await run(deps, { maxStudents: 3, concurrency: 3 })
    expect(llm.generate).toHaveBeenCalledTimes(3)
    expect(r).toMatchObject({ generated: 3, remaining: 2, stoppedBy: 'limit' })
  })

  it('時間の上限を過ぎたら新しい生徒に着手せず止まる', async () => {
    const db = five()
    let t = 1_000_000
    const { deps, llm } = makeDeps(db, { now: () => t })
    llm.generate.mockImplementation(async () => {
      t += 60_000 // 1 人あたり 60 秒かかる想定
      return { text: '## 本文', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm' }
    })

    const r = await run(deps, { timeBudgetMs: 100_000, concurrency: 1 })
    // 0 秒 → 着手 / 60 秒 → 着手 / 120 秒 → 100 秒を超えているので停止
    expect(llm.generate).toHaveBeenCalledTimes(2)
    expect(r).toMatchObject({ generated: 2, remaining: 3, stoppedBy: 'time', mail: 'deferred' })
  })

  it('LLM が 1 人分失敗しても他の生徒は続行し、失敗は記録して次の実行で再試行できる', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A'), person('p2', '生徒B'), person('p3', '生徒C')],
      messages: ['p1', 'p2', 'p3'].flatMap((id) => qa(id)),
    })
    const { deps, llm } = makeDeps(db)
    llm.generate.mockImplementationOnce(async () => {
      throw new Error('rate limited')
    })
    const r = await run(deps, { concurrency: 1 })

    expect(r).toMatchObject({ generated: 2, failed: 1, remaining: 1, mail: 'deferred' })
    expect(deps.sendEmail).not.toHaveBeenCalled()
    const errors = db.__rows('ai_error_logs')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ error_code: 'MONTHLY_REPORT_FAILED', person_id: 'p1' })
    expect(String(errors[0].internal_message)).toContain('rate limited')

    // 次の実行: 失敗した p1 だけをやり直し、全員揃ったのでメールを送る
    const next = await run(deps, { concurrency: 1 })
    expect(next).toMatchObject({ generated: 1, alreadyGenerated: 2, failed: 0, remaining: 0, mail: 'sent' })
    expect(llm.generate).toHaveBeenCalledTimes(4)
  })

  it('最後の試行（cron の 3 日目）では、未作成が残っていても作成済みを送り、未作成を本文で知らせる', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A'), person('p2', '生徒B')],
      messages: ['p1', 'p2'].flatMap((id) => qa(id)),
    })
    const { deps, llm } = makeDeps(db)
    llm.generate
      .mockImplementationOnce(async () => ({ text: '## 本文', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm' }))
      .mockImplementationOnce(async () => {
        throw new Error('still failing')
      })
    const r = await run(deps, { concurrency: 1, finalAttempt: true })

    expect(r).toMatchObject({ generated: 1, failed: 1, remaining: 1, mail: 'sent' })
    const mail = sentMessage(deps)
    expect(mail.attachments).toHaveLength(1)
    expect(mail.text).toContain('1名分はレポートを作成できていません')
    expect(mail.text).toContain('・生徒B: 1件（レポートを作成できていません）')
  })

  it('最後の試行でも、作成済みが 1 件も無いなら送らない', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const { deps, llm } = makeDeps(db)
    llm.generate.mockImplementation(async () => {
      throw new Error('down')
    })
    const r = await run(deps, { finalAttempt: true })
    expect(r).toMatchObject({ generated: 0, failed: 1, mail: 'deferred' })
    expect(deps.sendEmail).not.toHaveBeenCalled()
  })
})

describe('LLM を呼べないとき', () => {
  it('kill_switch で AI 応答が停止中なら LLM を呼ばず、メールも送らない', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { deps, llm } = makeDeps(db, { isAiEnabled: vi.fn(async () => false) })
    const r = await run(deps)
    expect(llm.generate).not.toHaveBeenCalled()
    expect(r).toMatchObject({ generationBlocked: 'ai_paused', generated: 0, remaining: 1, mail: 'deferred' })
    expect(db.__rows('reports')).toHaveLength(0)
    warn.mockRestore()
  })

  it('作成が不要（全員作成済み）なら、停止中でも LLM の可否を見ずにメールだけ送れる', async () => {
    const db = makeDb({
      persons: [person('p1', '生徒A')],
      messages: qa('p1'),
      reports: [{ id: 'r1', person_id: 'p1', report_month: MONTH_DATE, status: 'ai_draft', generated_by_ai: true, body_markdown: '下書き' }],
    })
    const { deps } = makeDeps(db, { isAiEnabled: vi.fn(async () => false) })
    const r = await run(deps)
    expect(deps.isAiEnabled).not.toHaveBeenCalled()
    expect(r.mail).toBe('sent')
  })

  it('モデル未設定・クライアント生成失敗は、落とさず理由を返す', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const db1 = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const noModel = await run(makeDeps(db1, { model: undefined }).deps)
    expect(noModel).toMatchObject({ generationBlocked: 'llm_not_configured', generated: 0, mail: 'deferred' })

    const db2 = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const noClient = await run(
      makeDeps(db2, {
        getLlm: () => {
          throw new Error('LLM_API_KEY / LLM_BASE_URL が未設定です')
        },
      }).deps,
    )
    expect(noClient).toMatchObject({ generationBlocked: 'llm_not_configured', generated: 0 })
    warn.mockRestore()
  })
})

describe('最後の試行（cron の 3 日目）の #alerts 通知', () => {
  const alertText = (deps: MockedDeps) => (deps.alert.mock.calls[0] as unknown as [string])[0]

  it('AI 停止中で何も作れず、メールも送らない月は未作成の人数を知らせる', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A'), person('p2', '生徒B')], messages: [...qa('p1'), ...qa('p2')] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { deps } = makeDeps(db, { isAiEnabled: vi.fn(async () => false) })
    const r = await run(deps, { finalAttempt: true })
    expect(r.mail).toBe('deferred')
    expect(deps.alert).toHaveBeenCalledTimes(1)
    expect(alertText(deps)).toContain('2026-09 の月次レポート: 2名未作成')
    expect(alertText(deps)).toContain('緊急停止')
    warn.mockRestore()
  })

  it('LLM 未設定・全員失敗でも知らせる', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const db1 = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const noModel = makeDeps(db1, { model: undefined })
    await run(noModel.deps, { finalAttempt: true })
    expect(alertText(noModel.deps)).toContain('LLM が未設定')

    const db2 = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const failing = makeDeps(db2)
    failing.llm.generate.mockImplementation(async () => {
      throw new Error('down')
    })
    await run(failing.deps, { finalAttempt: true })
    expect(alertText(failing.deps)).toContain('1名未作成')
    expect(alertText(failing.deps)).toContain('作成に失敗')
    warn.mockRestore()
  })

  it('メール設定なしで送れなかった月は知らせる（作成は済んでいても）', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { deps } = makeDeps(db, { mail: null })
    const r = await run(deps, { finalAttempt: true })
    expect(r.mail).toBe('not_configured')
    expect(deps.alert).toHaveBeenCalledTimes(1)
    expect(alertText(deps)).toContain('メール未設定で送れませんでした')
    warn.mockRestore()
  })

  it('最後の試行でなければ（1・2 日目・手動）通知しない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const noMail = makeDeps(db, { mail: null })
    await run(noMail.deps)
    const paused = makeDeps(makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') }), {
      isAiEnabled: vi.fn(async () => false),
    })
    await run(paused.deps)
    expect(noMail.deps.alert).not.toHaveBeenCalled()
    expect(paused.deps.alert).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('正常に送れた最後の試行では通知しない', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const { deps } = makeDeps(db)
    const r = await run(deps, { finalAttempt: true })
    expect(r.mail).toBe('sent')
    expect(deps.alert).not.toHaveBeenCalled()
  })

  it('通知の送信が失敗しても結果は返る', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { deps } = makeDeps(db, {
      mail: null,
      alert: vi.fn(async () => {
        throw new Error('slack down')
      }),
    })
    expect((await run(deps, { finalAttempt: true })).mail).toBe('not_configured')
    warn.mockRestore()
    err.mockRestore()
  })
})

describe('送信成功後の記録（emailed_at）の失敗', () => {
  const failEmailed = (db: ReturnType<typeof makeDb>, times: number) =>
    db.__inject(
      'monthly_report_runs',
      'update',
      { message: 'db down' },
      times,
      (v) => v !== undefined && 'emailed_at' in v && Boolean(v.emailed_at),
    )

  it('1 回失敗しても再試行して記録でき、通知しない', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    failEmailed(db, 1)
    const { deps } = makeDeps(db)
    const r = await run(deps)
    expect(r.mail).toBe('sent')
    expect(db.__rows('monthly_report_runs')[0].emailed_at).toBeTruthy()
    expect(deps.alert).not.toHaveBeenCalled()
    expect(deps.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('再試行も失敗したら #alerts で知らせる（送信自体は成功として返す）', async () => {
    const db = makeDb({ persons: [person('p1', '生徒A')], messages: qa('p1') })
    failEmailed(db, 2)
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { deps } = makeDeps(db)
    const r = await run(deps)
    expect(r.mail).toBe('sent')
    expect(db.__rows('monthly_report_runs')[0].emailed_at).toBeFalsy()
    expect(deps.alert).toHaveBeenCalledTimes(1)
    const text = (deps.alert.mock.calls[0] as unknown as [string])[0]
    expect(text).toContain('送信済みですが')
    expect(text).toContain('emailed_at')
    err.mockRestore()
  })
})

describe('利用量ログとレート制限', () => {
  it('月次レポートの usage 行は message_ts が -summary で終わり、生徒の質問回数（1 時間 10 回）に数えられない', async () => {
    const students = ['p1', 'p2']
    const db = makeDb({
      persons: students.map((id) => person(id, `生徒${id}`)),
      messages: students.flatMap((id) => qa(id)),
      // p1 は直近 1 時間に通常の質問を 9 回している（あと 1 回で上限）
      usage: Array.from({ length: 9 }, (_, i) => ({
        id: `u${i}`,
        person_id: 'p1',
        message_ts: `170000000${i}.000100`,
        created_at: new Date().toISOString(),
      })),
    })
    const { deps } = makeDeps(db)
    await run(deps)

    const monthly = db.__rows('ai_usage_logs').filter((r) => r.slack_channel_id === 'monthly_report')
    expect(monthly).toHaveLength(2)
    for (const row of monthly) expect(String(row.message_ts)).toMatch(/-summary$/)

    const { checkQuestionRateLimit } = await import('@features/rate-limit')
    // 月次レポートの 1 行が数えられていれば 10 件で上限に達してしまう
    expect(await checkQuestionRateLimit(db, 'p1')).toEqual({ limited: false, count: 9 })
  })
})
