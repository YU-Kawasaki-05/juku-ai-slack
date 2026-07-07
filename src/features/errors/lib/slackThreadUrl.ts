/** @file
 * 機能: Slack スレッド URL の組み立て（archives 形式）
 * 入力: ワークスペース URL（env）、channel_id、thread_ts
 * 出力: URL 文字列。材料が欠けていれば null（リンク非表示）
 * @implements FR-17（SCR-12 のスレッドリンク）
 */
export function buildSlackThreadUrl(
  workspaceUrl: string | undefined,
  channelId: string | null,
  threadTs: string | null,
): string | null {
  if (!workspaceUrl || !channelId || !threadTs) return null
  // '1718000000.123456' → 'p1718000000123456'
  const ts = threadTs.replace('.', '')
  if (!/^\d+$/.test(ts)) return null
  return `${workspaceUrl.replace(/\/+$/, '')}/archives/${channelId}/p${ts}`
}
