/** @file
 * 機能: 月次レポートの自動作成とメール送付の本体（cron と管理画面のボタンが同じ関数を呼ぶ）
 * 入力: RunDeps（DB・LLM・メール・時計などの依存。DI でテスト可能）、RunOptions（対象月・上限）
 * 出力: MonthlyReportsResult（件数と、メールの結果）
 * 例外: DB の読み書き失敗は throw（呼び出し側が 500 / エラー表示にする）。
 *   生徒 1 人の LLM 失敗・メール送信失敗・メール設定なしは throw せず結果に出す
 * 依存: monthlyReportData, buildReportPrompt, buildReportEmail, attachmentName, logUsage, logError
 * 副作用: reports への insert（status=ai_draft, generated_by_ai=true）、LLM 呼び出し、Embedding 生成、
 *   メール送信（1 か月 1 通）、monthly_report_runs の更新、失敗時の運用アラート
 * セキュリティ: 呼び出し側が認可済み（cron は CRON_SECRET、ボタンは requireAdmin）。
 *   スタッフが手で書いた前月分（generated_by_ai=false）は上書きしない。
 *   AI 作成分は ai_draft のため match_report_chunks（approved/sent のみ）に混ざらない
 * @implements FR-08, DEC-16
 */
import type { ServerDb } from '@shared/types/db'
import {
  MONTHLY_REPORT_CONCURRENCY,
  MONTHLY_REPORT_MAX_STUDENTS_PER_RUN,
  MONTHLY_REPORT_MAX_TOKENS,
  MONTHLY_REPORT_TIME_BUDGET_MS,
} from '@shared/lib/constants'
import { escapeSlackText } from '@shared/lib/slack/escapeSlackText'
import { queryError } from '@shared/lib/supabase/queryError'
import { calculateCost, type LlmClient } from '@features/ai-answer'
import { logError } from '@features/error-logs'
import { logUsage } from '@features/usage-logs'
import { buildAttachmentFileName } from './attachmentName'
import { buildReportEmail, type StudentMailRow } from './buildReportEmail'
import { buildReportPrompt } from './buildReportPrompt'
import {
  claimEmailSend,
  ensureRun,
  listActivePersons,
  loadAiReportBodies,
  loadExistingReports,
  loadMonthConversation,
  loadQuestionStats,
  markEmailFailed,
  markEmailed,
  markGenerated,
  personLabel,
  type ActivePerson,
} from './monthlyReportData'
import { formatMonthJa, toReportMonthDate } from './reportMonth'
import type { ConversationStats } from './buildReportPrompt'
import type { EmailMessage, EmailResult } from './sendResendEmail'

const PG_UNIQUE_VIOLATION = '23505'

/** 出力トークン上限で切れたときに本文の末尾へ足す（保存はする。スタッフが追記する前提） */
export const TRUNCATED_REPORT_NOTICE =
  '\n\n> 注意: 文字数の上限で途中までになっています。スタッフが内容を確認して追記してください。'

/** usage ログの channel / thread / message_ts は NOT NULL。会話に紐付かない処理なので固定値で識別する */
export const MONTHLY_REPORT_USAGE_CHANNEL = 'monthly_report'

/**
 * 月次レポートの usage ログの message_ts。末尾を `-summary` にして、既存の派生ログ（`<ts>-eval` / `<ts>-summary`）と
 * 同じ命名規約に載せる。checkQuestionRateLimit は `%-summary` を「質問ではない内部呼び出し」として除外するので、
 * 月次レポートの LLM 呼び出しが生徒の「1 時間 10 回」の枠を消費しない
 */
export function monthlyReportUsageMessageTs(month: string): string {
  return `${MONTHLY_REPORT_USAGE_CHANNEL}:${month}-summary`
}

export interface MailConfig {
  apiKey: string
  from: string
  to: string[]
}

export interface RunDeps {
  db: ServerDb
  /** LLM を使う直前に呼ぶ（未設定で throw する実装でも、作成が要らない月は落ちない） */
  getLlm: () => LlmClient
  /** 未設定なら undefined（メールは別として、レポートは作成できない） */
  model: string | undefined
  /** 宛先・API キー・送信元が揃っていなければ null（作成は行い、メールは送らない） */
  mail: MailConfig | null
  sendEmail: (message: EmailMessage, idempotencyKey: string) => Promise<EmailResult>
  /** メール本文の管理画面リンク用ドメイン（スキームなし） */
  adminHost?: string | null
  /** kill_switch（AI 応答の緊急停止）が有効か。停止中は LLM を呼ばない */
  isAiEnabled: () => Promise<boolean>
  /** 保存したレポートの Embedding を作る。設定なしなら何もしない。失敗は throw */
  rebuildEmbeddings: (reportId: string) => Promise<void>
  /** 運用アラート（#alerts）。失敗しても throw しない実装を渡す */
  alert: (text: string) => Promise<void>
  now: () => number
}

export interface RunOptions {
  /** 対象月 'YYYY-MM'（日本時間の前月） */
  month: string
  /**
   * 最後の試行か。true なら未作成の生徒が残っていても（作成済みが 1 件でもあれば）メールを送る。
   * cron の 3 日目に立てる。手動ボタンでは立てない（続きをもう一度押してもらう）
   */
  finalAttempt?: boolean
  maxStudents?: number
  timeBudgetMs?: number
  concurrency?: number
}

export type MailOutcome =
  /** 今回送った */
  | 'sent'
  /** この月は送信済みで何もしなかった */
  | 'already_sent'
  /** RESEND_API_KEY / RESEND_FROM_EMAIL / REPORT_EMAIL_TO のどれかが無い */
  | 'not_configured'
  /** 送信に失敗した（次の実行で再試行する） */
  | 'failed'
  /** 他の実行が送信中 */
  | 'in_progress'
  /** 未作成の生徒が残っているのでまだ送らない */
  | 'deferred'

export interface MonthlyReportsResult {
  month: string
  /** 有効な生徒の数 */
  students: number
  /** 質問が 0 件でレポートを作らない生徒の数 */
  noQuestions: number
  /** 今回新しく作成した件数 */
  generated: number
  /** 既に AI 作成済み（他の実行が先に作った場合を含む）で飛ばした件数 */
  alreadyGenerated: number
  /** スタッフが手で書いた分があり、上書きせず飛ばした件数 */
  manualExisting: number
  /** 今回作成に失敗した件数 */
  failed: number
  /** 作成待ちのまま残っている件数（上限・時間切れ・失敗を含む） */
  remaining: number
  /** 上限で止めた理由。止めていなければ null */
  stoppedBy: 'time' | 'limit' | null
  /** LLM を呼べなかった理由（kill_switch 停止中 / モデル未設定）。無ければ null */
  generationBlocked: 'ai_paused' | 'llm_not_configured' | null
  /** Embedding の生成に失敗した件数（レポートは保存済み。詳細ページに警告が出る） */
  embeddingFailed: number
  mail: MailOutcome
  mailError?: string
}

function emptyResult(month: string): MonthlyReportsResult {
  return {
    month,
    students: 0,
    noQuestions: 0,
    generated: 0,
    alreadyGenerated: 0,
    manualExisting: 0,
    failed: 0,
    remaining: 0,
    stoppedBy: null,
    generationBlocked: null,
    embeddingFailed: 0,
    mail: 'deferred',
  }
}

export async function runMonthlyReports(
  deps: RunDeps,
  opts: RunOptions,
): Promise<MonthlyReportsResult> {
  const { db } = deps
  const month = opts.month
  const monthDate = toReportMonthDate(month)
  const result = emptyResult(month)

  // 送信済みの月は何もしない（作り終えていれば cron の 2・3 日目はここで終わる）
  const run = await ensureRun(db, monthDate)
  if (run.emailedAt) return { ...result, mail: 'already_sent' }

  const persons = await listActivePersons(db)
  const stats = await loadQuestionStats(db, month)
  const existing = await loadExistingReports(db, monthDate)
  result.students = persons.length

  const pending: ActivePerson[] = []
  for (const p of persons) {
    if ((stats.get(p.id)?.questions ?? 0) === 0) {
      result.noQuestions++
      continue
    }
    const have = existing.get(p.id)
    if (!have) pending.push(p)
    else if (have.generatedByAi) result.alreadyGenerated++
    else result.manualExisting++
  }

  const doneIds = new Set<string>()
  if (pending.length > 0) {
    const ready = await resolveLlm(deps, result)
    if (ready) {
      result.stoppedBy = await generateAll(deps, ready, month, pending, opts, result, doneIds)
    }
  }
  result.remaining = pending.length - doneIds.size

  if (result.remaining === 0) {
    await markGenerated(db, monthDate, new Date(deps.now()).toISOString())
  }

  // メール: 全員分が揃ったら送る。最後の試行なら、残りがあっても作成済みがあれば送る
  const hasAnyReport = result.generated + result.alreadyGenerated > 0
  if (result.remaining > 0 && !(opts.finalAttempt && hasAnyReport)) {
    const deferred: MonthlyReportsResult = { ...result, mail: 'deferred' }
    if (opts.finalAttempt) await alertFinalAttempt(deps, deferred)
    return deferred
  }
  const mail = await deliverEmail(deps, { month, monthDate, persons, stats })
  const done: MonthlyReportsResult = { ...result, ...mail }
  if (opts.finalAttempt) await alertFinalAttempt(deps, done)
  return done
}

/** 運用アラートを送る。送信の失敗で本処理を壊さない */
async function safeAlert(deps: RunDeps, text: string): Promise<void> {
  try {
    await deps.alert(text)
  } catch (err) {
    console.error('[monthlyReports] 運用アラートの送信に失敗:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * 最後の試行（cron の 3 日目）で、この月の月次レポートが届かない状態で終わったときに #alerts へ知らせる。
 *   - 何も作れず、メールも送っていない（kill_switch 停止・LLM 未設定・全員失敗）
 *   - メール設定なしで送れなかった
 * メール送信の失敗は failEmail が別に通知する。cron の翌日以降は動かないので、ここで気づけなければ誰も気づけない
 */
async function alertFinalAttempt(deps: RunDeps, r: MonthlyReportsResult): Promise<void> {
  const lines: string[] = []
  if (r.mail === 'deferred') {
    const why =
      r.generationBlocked === 'ai_paused'
        ? 'AI 応答が緊急停止中'
        : r.generationBlocked === 'llm_not_configured'
          ? 'LLM が未設定'
          : `作成に失敗（${r.failed}名）`
    lines.push(`${r.remaining}名未作成で、メールも送っていません（${why}）`)
  } else if (r.mail === 'not_configured') {
    lines.push(
      `メール未設定で送れませんでした（RESEND_API_KEY / RESEND_FROM_EMAIL / REPORT_EMAIL_TO を確認してください）${r.remaining > 0 ? `。あわせて ${r.remaining}名未作成` : ''}`,
    )
  }
  if (lines.length === 0) return
  await safeAlert(
    deps,
    [
      `:warning: ${r.month} の月次レポート: ${lines[0]}`,
      'cron は今回が最後です。管理画面のレポート管理の「先月分を今すぐ作成して送る」（管理者のみ）で続きを実行できます。',
    ].join('\n'),
  )
}

interface ReadyLlm {
  llm: LlmClient
  model: string
}

/** LLM を使えるか判定する。使えないときは理由を result に入れて null を返す */
async function resolveLlm(deps: RunDeps, result: MonthlyReportsResult): Promise<ReadyLlm | null> {
  if (!deps.model) {
    result.generationBlocked = 'llm_not_configured'
    console.warn('[monthlyReports] LLM_MODEL_DEFAULT が未設定のため、レポートを作成できません')
    return null
  }
  if (!(await deps.isAiEnabled())) {
    result.generationBlocked = 'ai_paused'
    console.warn('[monthlyReports] AI 応答が緊急停止中のため、レポートの作成を見送りました')
    return null
  }
  try {
    return { llm: deps.getLlm(), model: deps.model }
  } catch (err) {
    result.generationBlocked = 'llm_not_configured'
    console.warn(
      '[monthlyReports] LLM クライアントを作れません:',
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

/**
 * 作成待ちの生徒を、人数・時間の上限内で順に処理する（同時実行は concurrency 人まで）。
 * 上限に達したら新しい生徒に着手せず止まる（処理中の生徒は最後まで進める）。
 * 戻り値は、未着手が残って止まったときの理由
 */
async function generateAll(
  deps: RunDeps,
  ready: ReadyLlm,
  month: string,
  pending: ActivePerson[],
  opts: RunOptions,
  result: MonthlyReportsResult,
  doneIds: Set<string>,
): Promise<'time' | 'limit' | null> {
  const maxStudents = opts.maxStudents ?? MONTHLY_REPORT_MAX_STUDENTS_PER_RUN
  const deadline = deps.now() + (opts.timeBudgetMs ?? MONTHLY_REPORT_TIME_BUDGET_MS)
  const concurrency = Math.max(1, opts.concurrency ?? MONTHLY_REPORT_CONCURRENCY)

  const queue = [...pending]
  let started = 0
  let stop: 'time' | 'limit' | null = null

  async function worker(): Promise<void> {
    for (;;) {
      if (queue.length === 0) return
      if (deps.now() >= deadline) {
        stop = 'time'
        return
      }
      if (started >= maxStudents) {
        stop ??= 'limit'
        return
      }
      const person = queue.shift() as ActivePerson
      started++
      await generateOne(deps, ready, month, person, result, doneIds)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
  return queue.length > 0 ? stop : null
}

/** 生徒 1 人分。失敗しても throw せず failed に数える（次の実行で再試行される） */
async function generateOne(
  deps: RunDeps,
  { llm, model }: ReadyLlm,
  month: string,
  person: ActivePerson,
  result: MonthlyReportsResult,
  doneIds: Set<string>,
): Promise<void> {
  const { db } = deps
  try {
    const rows = await loadMonthConversation(db, person.id, month)
    const prompt = buildReportPrompt(month, rows)
    if (prompt.stats.questions === 0) {
      // 集計後に会話が読めなくなった場合の保険。作るものが無いので完了扱いにする
      result.noQuestions++
      doneIds.add(person.id)
      return
    }

    const startedAt = deps.now()
    const out = await llm.generate({
      system: prompt.system,
      messages: prompt.messages,
      model,
      maxTokens: MONTHLY_REPORT_MAX_TOKENS,
    })
    const latencyMs = deps.now() - startedAt

    // 保存に失敗しても課金は発生済みなので、先に利用量を残す
    await logUsage(db, {
      personId: person.id,
      channelId: MONTHLY_REPORT_USAGE_CHANNEL,
      threadTs: month,
      messageTs: monthlyReportUsageMessageTs(month),
      model,
      usage: out.usage,
      estimatedCost: calculateCost(model, out.usage),
      hasImage: false,
      latencyMs,
    })

    const body = out.text.trim() + (out.truncated ? TRUNCATED_REPORT_NOTICE : '')
    const { data, error } = await db
      .from('reports')
      .insert({
        person_id: person.id,
        report_month: toReportMonthDate(month),
        title: `${formatMonthJa(month)} 学習レポート`,
        body_markdown: body,
        status: 'ai_draft',
        generated_by_ai: true,
      })
      .select('id')
      .single()

    if (error) {
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        // 判定から保存までの間に、スタッフの手書きか別の実行が先に作った。上書きせず譲る
        result.alreadyGenerated++
        doneIds.add(person.id)
        return
      }
      throw queryError('insert report', error)
    }

    doneIds.add(person.id)
    result.generated++

    // ai_draft のうちに Embedding を作っておく。承認時に本文を変えないと再生成が走らず
    // 「承認したのに RAG で検索できない」状態になるため。ai_draft のチャンクは
    // match_report_chunks（approved / sent のみ）に出ないので、承認前に回答へ混ざらない
    try {
      await deps.rebuildEmbeddings(data.id)
    } catch (err) {
      result.embeddingFailed++
      console.warn(
        '[monthlyReports] embedding の生成に失敗（レポートは保存済み）:',
        err instanceof Error ? err.message : String(err),
      )
    }
  } catch (err) {
    result.failed++
    await logError(db, {
      code: 'MONTHLY_REPORT_FAILED',
      severity: 'error',
      personId: person.id,
      internalMessage: `monthly report generation failed (${month}): ${err instanceof Error ? err.message : String(err)}`,
      rawError: err,
    })
  }
}

interface DeliverContext {
  month: string
  monthDate: string
  persons: ActivePerson[]
  stats: Map<string, ConversationStats>
}

/**
 * 1 か月 1 通のメールを送る。二重送信は 3 重に防ぐ:
 *   (1) emailed_at が入っていれば送らない  (2) 送る前に条件付き UPDATE で権利を取る
 *   (3) Resend の Idempotency-Key
 */
async function deliverEmail(
  deps: RunDeps,
  ctx: DeliverContext,
): Promise<{ mail: MailOutcome; mailError?: string }> {
  const { db, mail } = deps
  const { month, monthDate } = ctx

  if (!mail) {
    // 作成だけ行い、設定が揃ってから送る。設定を直したあとの cron か手動ボタンで送られる
    console.warn(
      '[monthlyReports] メール設定なし（RESEND_API_KEY / RESEND_FROM_EMAIL / REPORT_EMAIL_TO）。送信をスキップしました',
    )
    return { mail: 'not_configured' }
  }

  if (!(await claimEmailSend(db, monthDate, deps.now()))) {
    const latest = await ensureRun(db, monthDate)
    return { mail: latest.emailedAt ? 'already_sent' : 'in_progress' }
  }

  try {
    const message = await buildMessage(deps, mail, ctx)
    const sent = await deps.sendEmail(message, `monthly-report-${month}`)
    if (!sent.ok) return await failEmail(deps, ctx, sent.error)
  } catch (err) {
    return await failEmail(deps, ctx, err instanceof Error ? err.message : String(err))
  }

  // 送信は成功している。記録（emailed_at）だけ失敗した場合は 1 回リトライし、それでも駄目なら知らせる。
  // 記録が無いと次の実行が同じ月を送り直すが、Resend の Idempotency-Key（24 時間以内）で重複排除される
  try {
    await markEmailed(db, monthDate, new Date(deps.now()).toISOString())
  } catch {
    try {
      await markEmailed(db, monthDate, new Date(deps.now()).toISOString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[monthlyReports] メールは送信済みだが emailed_at の記録に失敗:', message)
      await safeAlert(
        deps,
        [
          `:warning: ${formatMonthJa(month)}分の月次レポートのメールは送信済みですが、送信済みの記録に失敗しました`,
          `理由: ${escapeSlackText(message)}`,
          '次の実行で同じメールが再送される可能性があります（Resend の Idempotency-Key で 24 時間以内は重複排除されます）。monthly_report_runs の emailed_at を確認してください。',
        ].join('\n'),
      )
    }
  }
  return { mail: 'sent' }
}

async function buildMessage(
  deps: RunDeps,
  mail: MailConfig,
  ctx: DeliverContext,
): Promise<EmailMessage> {
  const { db } = deps
  const { month, monthDate } = ctx
  const [existingNow, bodies] = await Promise.all([
    loadExistingReports(db, monthDate),
    loadAiReportBodies(db, monthDate),
  ])

  const usedNames = new Set<string>()
  const attachments: EmailMessage['attachments'] = []
  const rows: StudentMailRow[] = []
  for (const p of ctx.persons) {
    const label = personLabel(p)
    const questions = ctx.stats.get(p.id)?.questions ?? 0
    if (questions === 0) {
      rows.push({ displayName: label, questions: 0, status: 'no_questions' })
      continue
    }
    const body = bodies.get(p.id)
    if (body) {
      attachments.push({ filename: buildAttachmentFileName(month, label, usedNames), content: body })
      rows.push({ displayName: label, questions, status: 'attached' })
    } else if (existingNow.has(p.id)) {
      rows.push({ displayName: label, questions, status: 'manual' })
    } else {
      rows.push({ displayName: label, questions, status: 'missing' })
    }
  }

  const { subject, text } = buildReportEmail({
    month,
    rows,
    attachedCount: attachments.length,
    adminHost: deps.adminHost,
  })
  return { from: mail.from, to: mail.to, subject, text, attachments }
}

async function failEmail(
  deps: RunDeps,
  ctx: DeliverContext,
  error: string,
): Promise<{ mail: MailOutcome; mailError: string }> {
  try {
    await markEmailFailed(deps.db, ctx.monthDate, error)
  } catch (err) {
    console.error(
      '[monthlyReports] email_error の記録に失敗:',
      err instanceof Error ? err.message : String(err),
    )
  }
  await safeAlert(
    deps,
    [
      `:warning: ${formatMonthJa(ctx.month)}分の月次レポートのメール送信に失敗しました`,
      `理由: ${escapeSlackText(error)}`,
      'レポート自体は管理画面の「レポート管理」にあります。cron（毎月 1〜3 日）の次回実行か、レポート管理の「先月分を今すぐ作成して送る」で再試行できます。',
    ].join('\n'),
  )
  return { mail: 'failed', mailError: error }
}
