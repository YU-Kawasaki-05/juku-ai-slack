/** @file
 * 機能: 単価未登録モデルの警告（#7）。コスト表示が実額より小さく出る原因と対処を画面上で説明する
 * 備考: 「0円だから安い」と誤解したまま運用が続くのが最大の損失なので、
 *   金額カードのすぐ上に置き、対処手順まで書き切る（既存ログは再計算されない旨も含む）
 * @implements FR-18
 */
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function UnpricedModelsAlert({
  models,
  scope,
}: {
  models: string[]
  /** 集計範囲の説明（例: 「直近30日」「これまで」）。どの数字が過少なのかを明示する */
  scope: string
}) {
  if (models.length === 0) return null

  return (
    <Alert variant="warning">
      <TriangleAlert className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>単価が未登録のモデルが使われています（コスト表示は実額より小さく出ます）</AlertTitle>
      <AlertDescription className="space-y-1.5">
        <p>
          {scope}の利用のうち、次のモデルは単価が未登録のため 0 円として集計されています:{' '}
          <span className="font-mono font-medium">{models.join(', ')}</span>
        </p>
        <p>
          対処: <code className="font-mono">src/shared/lib/constants.ts</code> の{' '}
          <code className="font-mono">MODEL_PRICING</code>{' '}
          にモデル名と単価を追加して再デプロイしてください。
          既存のログは遡って再計算されないため、追加後に記録されたぶんから正しい金額になります。
        </p>
      </AlertDescription>
    </Alert>
  )
}
