/** @file
 * 機能: AI 回答（適応型応答戦略）の型
 * @implements FR-05, DEC-23
 */

/** 3モード適応型応答戦略（DEC-23） */
export type TutorMode = 'direct' | 'socratic' | 'confirmation'

/** モード選択の入力 */
export interface SelectModeInput {
  /** 対象トピックの習熟度（0〜1）。未取得時は P_MASTERY_DEFAULT を渡す */
  pMastery: number
  /** 試験前モード（exam_mode_until が未来）。ON なら常に direct。BR-05-08 */
  examMode: boolean
}
