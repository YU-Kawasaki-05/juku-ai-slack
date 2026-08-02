/** @file
 * 機能: 単価が MODEL_PRICING に無いモデルの検出（#7）
 * 入力: モデル名の配列、または Supabase クライアント（Service Role）
 * 出力: 単価未登録のモデル名（重複排除・昇順）
 * 例外: RPC 失敗は queryError で文脈付きに変換して伝播
 * 依存: findModelPrice（constants）、RPC admin_used_models（migration 029）
 * 備考: 単価未登録のモデルは calculateCost が 0 を返すため、コスト表示が実額より小さく出る。
 *   画面で気づけないと損失が積み上がるので、管理画面に警告を出すための判定をここに集約する
 * @implements FR-18
 */
import type { ServerDb } from '@shared/types/db'
import { findModelPrice } from '@shared/lib/constants'
import { queryError } from '@shared/lib/supabase/queryError'

/** 単価が引けないモデル名だけを返す（重複排除・昇順） */
export function findUnpricedModels(models: (string | null | undefined)[]): string[] {
  const unpriced = new Set<string>()
  for (const model of models) {
    if (!model) continue
    if (!findModelPrice(model)) unpriced.add(model)
  }
  return [...unpriced].sort()
}

/**
 * これまでに利用実績のあるモデルのうち単価未登録のものを返す。
 * 期間を絞らないのは、過去ログは単価を追加しても再計算されない＝過去に一度でも
 * 未登録モデルを使っていれば累計コストは常に過少である、という事実を伝えたいため。
 */
export async function getUnpricedModels(db: ServerDb): Promise<string[]> {
  const { data, error, status, statusText } = await db.rpc('admin_used_models')
  if (error) throw queryError('getUnpricedModels', error, { status, statusText })
  return findUnpricedModels(data ?? [])
}
