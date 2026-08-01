/** @file
 * 機能: 経過時間の日本語表記（ジョブ一覧・集計カードの「どれだけ滞留しているか」表示）
 * 入力: 基準時刻の ISO 文字列, 現在時刻（ミリ秒）
 * 出力: '3分' / '2時間14分' / '1日3時間' など。材料がなければ '—'
 * @implements F-4
 */
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatElapsed(fromIso: string | null | undefined, nowMs: number): string {
  if (!fromIso) return '—'
  const from = Date.parse(fromIso)
  if (Number.isNaN(from)) return '—'

  const diff = nowMs - from
  // 端末とサーバーの時計ずれで未来時刻になることがある。マイナス表示は避ける
  if (diff < MINUTE) return '1分未満'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分`
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR)
    const minutes = Math.floor((diff % HOUR) / MINUTE)
    return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`
  }
  const days = Math.floor(diff / DAY)
  const hours = Math.floor((diff % DAY) / HOUR)
  return hours > 0 ? `${days}日${hours}時間` : `${days}日`
}
