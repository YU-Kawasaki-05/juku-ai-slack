/** @file
 * 機能: フォームのフィールド単位エラー表示（H-8）
 * 備考: 以前は一部のフィールドしか fieldErrors を描画しておらず、
 *   サーバー側バリデーションで弾かれても「入力内容を確認してください」としか出ず
 *   どの項目が悪いのか分からなかった。入力側の aria-describedby と id を対で使う
 * @implements FR-14, FR-15, FR-16
 */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  )
}
