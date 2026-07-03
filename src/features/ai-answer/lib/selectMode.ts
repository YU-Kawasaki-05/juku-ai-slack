/** @file
 * 機能: P(mastery) と試験前モードから応答モードを決定する純粋関数
 * 入力: SelectModeInput
 * 出力: TutorMode
 * 例外: なし
 * 依存: なし
 * @implements FR-05, DEC-23, AC-05-02, AC-05-03, AC-05-05
 */
import { P_MASTERY_DIRECT_MAX, P_MASTERY_SOCRATIC_MAX } from '@shared/lib/constants'
import type { SelectModeInput, TutorMode } from '../types'

/**
 * DEC-23 の3モード判定。
 * - 試験前モード ON → direct（要点・スピード優先）。BR-05-08
 * - P < 0.3 → direct（直接指導 + ワークド例題）
 * - 0.3 ≤ P < 0.8 → socratic（確認質問1問）
 * - P ≥ 0.8 → confirmation（確認質問のみ）
 */
export function selectMode(input: SelectModeInput): TutorMode {
  if (input.examMode) return 'direct'
  if (input.pMastery < P_MASTERY_DIRECT_MAX) return 'direct'
  if (input.pMastery < P_MASTERY_SOCRATIC_MAX) return 'socratic'
  return 'confirmation'
}
