/** @file
 * 機能: メール添付・ダウンロードの .md ファイル名を作る（YYYY-MM_<生徒の表示名>.md）
 * 入力: 対象月 'YYYY-MM'、生徒の表示名、すでに使った名前の集合（同名の生徒の衝突回避）
 * 出力: ファイル名（OS・メールソフトで問題になる文字を置き換え済み）
 * 例外: なし
 * 依存: なし（純粋関数）
 * セキュリティ: 表示名は人が入力した文字列。パス区切り・制御文字・先頭のドット・改行（ヘッダ注入）を
 *   取り除く。ここで返した名前をそのまま Content-Disposition や添付名に使う
 * @implements FR-08
 */

/** ファイル名に使えない／紛らわしい文字（Windows の禁止文字 + 制御文字 + 引用符。空白類も _ にする） */
const UNSAFE_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f\s]+/g
const MAX_NAME_LENGTH = 60
const FALLBACK_NAME = '生徒'

/**
 * 表示方向を変える Unicode 制御文字（LRM/RLM U+200E/200F、埋め込み・上書き U+202A〜202E、
 * 分離 U+2066〜2069）。ファイル名の見かけを偽装できる（例: 拡張子が逆順に見える）ので取り除く
 */
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

export function sanitizeFileNamePart(name: string): string {
  let cleaned = name.normalize('NFC').replace(BIDI_CONTROLS, '').replace(UNSAFE_CHARS, '_')
  // 先頭のドット（隠しファイル・相対パス）と、両端の _ を落とす
  cleaned = cleaned.replace(/^[._]+/, '').replace(/_+$/, '')
  // サロゲートペアを壊さないよう、コードポイント単位で切る
  cleaned = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('')
  return cleaned || FALLBACK_NAME
}

/**
 * `YYYY-MM_<表示名>.md`。同名の生徒がいて used に同じ名前があれば `_2`, `_3` を付ける。
 * 返した名前は used に追加される。
 */
export function buildAttachmentFileName(
  month: string,
  displayName: string,
  used: Set<string> = new Set(),
): string {
  const base = `${month}_${sanitizeFileNamePart(displayName)}`
  let candidate = `${base}.md`
  for (let n = 2; used.has(candidate); n++) candidate = `${base}_${n}.md`
  used.add(candidate)
  return candidate
}
