/** @file
 * 機能: 簡略化 BKT（Bayesian Knowledge Tracing）の純粋数式実装
 * 入力/出力: p_mastery(0〜1) と 正誤 → 更新後 p_mastery
 * 例外: なし
 * 依存: 定数（学習率/ゲス率/スリップ率）
 * @implements FR-23, DEC-24, AC-23-01, AC-23-02
 */
import { BKT_P_LEARN, BKT_P_GUESS, BKT_P_SLIP } from '@shared/lib/constants'

/**
 * p_mastery の下限・上限（G-5）。
 * 浮動小数の丸めで p が厳密に 1.0 に到達すると、以後どんな不正解でもベイズ更新の
 * 分母 (1-p) が 0 になり p が動かなくなる（吸収状態: 連続正解 24 回で実際に到達する）。
 * 0.0 側も同様に「二度と上がらない」状態を作るため、両端を開区間に丸める。
 */
const P_MASTERY_EPSILON = 1e-6
const P_MASTERY_MIN = P_MASTERY_EPSILON
const P_MASTERY_MAX = 1 - P_MASTERY_EPSILON

/** p_mastery を (0, 1) の開区間に収める（吸収状態の防止） */
export function clampMastery(p: number): number {
  if (Number.isNaN(p)) return P_MASTERY_MIN
  return Math.min(P_MASTERY_MAX, Math.max(P_MASTERY_MIN, p))
}

/**
 * 観測（正誤）を反映して p_mastery を更新する。
 * 事後確率 P(obs) を求め、学習遷移 P(T) を加味して返す。
 * 返り値は必ず (0, 1) の開区間に丸める（G-5）。
 */
export function updateBKT(
  pMastery: number,
  isCorrect: boolean,
  pT: number = BKT_P_LEARN,
  pG: number = BKT_P_GUESS,
  pS: number = BKT_P_SLIP,
): number {
  const p = clampMastery(pMastery)
  const pObs = isCorrect
    ? (p * (1 - pS)) / (p * (1 - pS) + (1 - p) * pG)
    : (p * pS) / (p * pS + (1 - p) * (1 - pG))
  return clampMastery(pObs + (1 - pObs) * pT)
}

/**
 * 時間減衰（TASA 論文準拠）: 1週間経過ごとに 1% 減衰。
 * @param daysSinceLastSeen 前回学習からの経過日数
 */
export function applyForgettingDecay(pMastery: number, daysSinceLastSeen: number): number {
  const weeksPassed = daysSinceLastSeen / 7
  return pMastery * Math.pow(0.99, weeksPassed)
}
