/** @file
 * 機能: Evaluator LLM — 直前の確認質問と生徒の返信を評価し EvaluationSchema を得る
 * 入力: LlmClient, { botQuestion, studentReply }, model
 * 出力: { evaluation, result }（result は使用量記録用）
 * 例外: JSON 抽出/検証に失敗（リトライ後も）で AiResponseFailedError
 * 依存: LlmClient, evaluationSchema
 * 副作用: LLM 呼び出し（LlmClient 経由）
 * セキュリティ: 生徒の返信は信頼できない入力。system 指示で JSON のみを要求し、出力は Zod 検証
 * @implements FR-23, DEC-24, AC-23-04
 */
import { AiResponseFailedError } from '@shared/lib/errors/AppError'
import type { LlmClient, LlmResult } from '@features/ai-answer'
import { evaluationSchema, type Evaluation } from './evaluationSchema'

const EVALUATOR_SYSTEM = `あなたは学習ログ評価器です。会話の「直前の確認質問」と「生徒の返信」を読み、生徒の理解状態を評価します。

必ず次のキーだけを持つ JSON オブジェクトを1つだけ出力してください（前後に文章やマークダウンを付けない）:
- "reasoning": 評価の思考過程（signal より先に書く）
- "signal": "correct" | "incorrect" | "partial" | "skip"
    - correct=正解 / incorrect=不正解 / partial=部分的に正解
    - skip=「次」「わからない」等のスキップ・拒否・無関係な返信・スタンプのみ
- "identified_misconception": incorrect/partial のときの誤概念の短い要約。correct/skip は null
- "topic_id": トピックID（例 "二次方程式" "be動詞"）。特定不能は "unknown"
- "subject": 科目（例 "数学" "英語"）
- "confidence": 0〜1 の確信度`

const EVALUATOR_MAX_TOKENS = 500

export interface EvaluateInput {
  /** 直前に Bot が出した確認質問 */
  botQuestion: string
  /** 生徒の返信（評価対象） */
  studentReply: string
}

export interface EvaluateResult {
  evaluation: Evaluation
  result: LlmResult
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object in evaluator output')
  }
  return JSON.parse(body.slice(start, end + 1))
}

function tryParse(text: string): Evaluation | null {
  try {
    const parsed = evaluationSchema.safeParse(extractJson(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function evaluate(
  llm: LlmClient,
  input: EvaluateInput,
  model: string,
): Promise<EvaluateResult> {
  const userContent = `直前の確認質問:\n${input.botQuestion}\n\n生徒の返信:\n${input.studentReply}\n\n上記を評価し、指定の JSON のみを出力してください。`

  const result = await llm.generate({
    system: EVALUATOR_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
    model,
    maxTokens: EVALUATOR_MAX_TOKENS,
    temperature: 0,
  })

  let evaluation = tryParse(result.text)
  if (!evaluation) {
    // 1回だけリトライ（JSON のみを強く要求）
    const retry = await llm.generate({
      system: EVALUATOR_SYSTEM,
      messages: [
        { role: 'user', content: userContent },
        { role: 'assistant', content: result.text },
        { role: 'user', content: '有効な JSON オブジェクトだけを、余計な文字なしで再出力してください。' },
      ],
      model,
      maxTokens: EVALUATOR_MAX_TOKENS,
      temperature: 0,
    })
    evaluation = tryParse(retry.text)
    if (!evaluation) {
      throw new AiResponseFailedError('Evaluator の出力を JSON として解釈できませんでした')
    }
    return { evaluation, result: retry }
  }

  return { evaluation, result }
}
