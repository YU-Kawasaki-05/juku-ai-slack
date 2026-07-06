/** @file
 * 機能: Server Action の共通結果型
 * @implements -
 */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
