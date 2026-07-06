/** @file
 * 機能: Evaluator LLM の構造化出力スキーマ（Chain-of-Thought 強制）
 * 出力: EvaluationSchema（reasoning を先出し → signal → misconception）
 * @implements FR-23, DEC-24, AC-23-04
 */
import { z } from 'zod'

/**
 * reasoning を最初に置くことで、signal を出す前に思考過程を書かせる（CoT 強制）。
 */
export const evaluationSchema = z.object({
  reasoning: z
    .string()
    .min(1)
    .describe('生徒の回答を評価するための思考過程。signal を出力する前に必ず記述する'),
  signal: z
    .enum(['correct', 'incorrect', 'partial', 'skip'])
    .describe(
      'correct: 正解 / incorrect: 不正解 / partial: 部分的に正解 / skip: スキップ・拒否・無関係な返信',
    ),
  identified_misconception: z
    .string()
    .nullable()
    .describe('incorrect/partial の場合の誤概念・知識ギャップの短い要約。correct/skip は null'),
  topic_id: z
    .string()
    .describe("該当トピックID（例: '二次方程式' '因数分解' 'be動詞'）。特定不能は 'unknown'"),
  subject: z.string().describe("科目（例: '数学' '英語' '国語'）"),
  confidence: z.number().min(0).max(1).describe('このシグナルに対する確信度'),
})

export type Evaluation = z.infer<typeof evaluationSchema>
export type EvaluationSignal = Evaluation['signal']
