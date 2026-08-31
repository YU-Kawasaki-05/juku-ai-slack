/** @file
 * 機能: 試験期間（student_profiles.exam_mode_until）と入力フォームの日付表現の相互変換
 * 入力: JST の暦日文字列（YYYY-MM-DD）または TIMESTAMPTZ の ISO 文字列
 * 出力: ISO 文字列 / 暦日文字列 / 有効判定
 * 例外: なし（不正な入力は呼び出し側が Zod で弾く）
 * 依存: なし
 * 副作用: なし
 * 備考: 管理画面の入力は「試験の最終日」（JST の暦日）。DB には「その日の 24:00 JST」を保存する。
 *   サーバーの TZ 設定に依存させないため JST を固定オフセットで扱う（日本は DST なし）
 * @implements FR-09, FR-05, DEC-18, BR-05-08
 */

const jstParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Date → JST の暦日（YYYY-MM-DD）。ロケールデータ差を避けるため parts から組み立てる */
function toJstDate(d: Date): string {
  const parts = jstParts.formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** 今日（JST）の暦日。date 入力の min 値と「過去日を弾く」検証に使う */
export function jstToday(now: Date = new Date()): string {
  return toJstDate(now)
}

/**
 * 試験の最終日（JST の暦日）→ exam_mode_until に入れる ISO 文字列。
 * 「8/10 まで」は 8/10 いっぱい有効にしたいので、翌日 00:00 JST（= 同日 15:00 UTC）を境界にする。
 */
export function examDateToUntilIso(jstDate: string): string {
  return `${jstDate}T15:00:00.000Z`
}

/** exam_mode_until → 試験の最終日（JST の暦日）。24:00 JST は翌日 00:00 と同時刻なので 1ms 戻す */
export function untilIsoToExamDate(iso: string): string {
  return toJstDate(new Date(new Date(iso).getTime() - 1))
}

/** 試験期間が現在有効か（BR-05-08）。getStudentProfile の examMode と同じ判定 */
export function isExamModeActive(until: string | null | undefined, now: Date = new Date()): boolean {
  return until ? new Date(until) > now : false
}

export interface ExamPeriodDefaults {
  /** 現在有効かどうか（チェックボックスの初期値） */
  active: boolean
  /** date 入力の初期値。期間切れ・未設定なら空文字 */
  endDate: string
}

/**
 * 保存済みの exam_mode_until をフォームの初期値に変換する。
 * 期限切れの値は「有効な設定」として復元しない — チェック済みなのに効いていない状態を見せないため。
 * 判定にサーバー時刻を使うので、呼び出しは Server Component 側で行う（hydration 不一致の回避）。
 */
export function toExamPeriodDefaults(
  until: string | null | undefined,
  now: Date = new Date(),
): ExamPeriodDefaults {
  if (!isExamModeActive(until, now)) return { active: false, endDate: '' }
  return { active: true, endDate: untilIsoToExamDate(until as string) }
}
