/** @file
 * 機能: 簡略化 BKT（Bayesian Knowledge Tracing）の純粋数式実装
 * 入力/出力: p_mastery(0〜1) と 正誤 → 更新後 p_mastery
 * 例外: なし
 * 依存: 定数（学習率/ゲス率/スリップ率）
 * @implements FR-23, DEC-24, AC-23-01, AC-23-02
 */
import { BKT_P_LEARN, BKT_P_GUESS, BKT_P_SLIP } from '@shared/lib/constants'

/**
 * 観測（正誤）を反映して p_mastery を更新する。
 * 事後確率 P(obs) を求め、学習遷移 P(T) を加味して返す。
 */
export function updateBKT(
  pMastery: number,
  isCorrect: boolean,
  pT: number = BKT_P_LEARN,
  pG: number = BKT_P_GUESS,
  pS: number = BKT_P_SLIP,
): number {
  const pObs = isCorrect
    ? (pMastery * (1 - pS)) / (pMastery * (1 - pS) + (1 - pMastery) * pG)
    : (pMastery * pS) / (pMastery * pS + (1 - pMastery) * (1 - pG))
  return pObs + (1 - pObs) * pT
}

/**
 * 時間減衰（TASA 論文準拠）: 1週間経過ごとに 1% 減衰。
 * @param daysSinceLastSeen 前回学習からの経過日数
 */
export function applyForgettingDecay(pMastery: number, daysSinceLastSeen: number): number {
  const weeksPassed = daysSinceLastSeen / 7
  return pMastery * Math.pow(0.99, weeksPassed)
}
