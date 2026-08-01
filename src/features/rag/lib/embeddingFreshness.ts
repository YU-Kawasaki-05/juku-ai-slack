/** @file
 * 機能: レポートの embedding が本文より古い（= 再生成が必要）かを判定する純粋関数
 * 入力: embeddings_updated_at / updated_at（いずれも DB の timestamptz 文字列）
 * 出力: boolean
 * 例外: なし
 * 依存: なし
 * @implements FR-16, BR-16-03
 */

/**
 * 文字列比較だと小数秒の桁数やタイムゾーンオフセットの表記差で誤判定しうるため、
 * 必ずエポックミリ秒に正規化して比較する。パース不能な値は安全側（要再生成）に倒す。
 */
export function needsEmbeddingRebuild(
  embeddingsUpdatedAt: string | null | undefined,
  updatedAt: string | null | undefined,
): boolean {
  if (!embeddingsUpdatedAt) return true
  const embeddedAt = Date.parse(embeddingsUpdatedAt)
  const updated = updatedAt ? Date.parse(updatedAt) : NaN
  if (Number.isNaN(embeddedAt)) return true
  if (Number.isNaN(updated)) return false
  return embeddedAt < updated
}
