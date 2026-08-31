/** @file
 * 機能: LLM 送信前に画像の長辺を MAX_IMAGE_LONG_EDGE まで縮小する（超過分だけ）
 *   Vision のトークン数は解像度にほぼ比例し `detail` パラメータでは変わらないため、
 *   コストに天井を作る手段は「送る画像のピクセル数を減らす」ことだけ（constants の
 *   MAX_IMAGE_LONG_EDGE のコメントに実測値）。
 * 入力: bytes（ダウンロード直後の生バイト列）, mimetype（SUPPORTED_IMAGE_MIMETYPES）
 * 出力: { bytes, resized, width, height }
 * 例外: なし。デコード失敗・非対応形式・寸法不明はすべて元のバイト列をそのまま返す
 * 依存: sharp（ネイティブ。nodejs runtime 専用。Edge runtime では動かない）
 * 副作用: なし（純粋関数。CPU のみ）
 * セキュリティ: 再エンコード経路では sharp が入力のメタデータを一切引き継がないため
 *   EXIF/GPS は出力に残らない。縮小しなかった画像は呼び出し側で stripImageMetadata を通す
 * @implements FR-06, BR-06-05
 */
import sharp from 'sharp'
import { MAX_IMAGE_LONG_EDGE } from '@shared/lib/constants'

/**
 * sharp のパイプライン型。
 * sharp 0.35 で `sharp.Sharp` の名前空間参照が default import 経由では解決できなくなったため、
 * 戻り値型から導出する。この書き方なら型の内部構造が変わっても追随不要。
 */
type SharpPipeline = ReturnType<typeof sharp>

export interface ResizeImageResult {
  /** 縮小後のバイト列。縮小しなかった場合は入力と同一インスタンス */
  bytes: Uint8Array
  /**
   * true なら再エンコードされている（＝メタデータは落ちている）。
   * false は「上限以下だった」「非対応形式」「デコードできなかった」のいずれかで、
   * このとき bytes は 1 バイトも変わっていない
   */
  resized: boolean
  /** 出力の長辺（px）。寸法を取得できなかった場合は undefined */
  longEdge?: number
}

/**
 * JPEG 再エンコードの品質。
 * トークン数はピクセル数だけで決まりバイト数に依存しないため、品質を上げてもコストは増えない。
 * 一方で下げすぎると鉛筆の細線や小さな添え字が潰れて誤読の原因になる。
 * 85 はスマホ写真の一般的な保存品質（90 前後）から視覚的な劣化がほぼ無い水準。
 * この値と chromaSubsampling は resizeImage.test.ts が固定している（下げるとテストが落ちる）。
 */
const JPEG_QUALITY = 85
/** WebP も同じ理由で 85（WebP は同品質値で JPEG より高画質側に出る）。同じくテストで固定 */
const WEBP_QUALITY = 85

export async function resizeImage(bytes: Uint8Array, mimetype: string): Promise<ResizeImageResult> {
  const unchanged: ResizeImageResult = { bytes, resized: false }
  if (!isResizableMimetype(mimetype)) return unchanged

  try {
    // failOn: 'error' … 実写真によくある軽微な warning では諦めず、
    // 本当に壊れているものだけ例外にして元データへフォールバックする
    const probe = sharp(bytes, { failOn: 'error' })
    const meta = await probe.metadata()

    const isAnimated = (meta.pages ?? 1) > 1
    // アニメーション WebP は animated:true 抜きだと 1 フレーム目だけになり、
    // height も全フレームを縦に連結した値になるので論理サイズは pageHeight を見る
    const width = meta.width
    const height = meta.pageHeight ?? meta.height
    if (!width || !height) return unchanged

    const longEdge = Math.max(width, height)
    // 上限以下は 1 バイトも変えない（再エンコードによる劣化・EXIF 以外の欠落を避ける）
    if (longEdge <= MAX_IMAGE_LONG_EDGE) return { bytes, resized: false, longEdge }

    const pipeline = sharp(bytes, { failOn: 'error', animated: isAnimated }).resize({
      width: MAX_IMAGE_LONG_EDGE,
      height: MAX_IMAGE_LONG_EDGE,
      fit: 'inside', // アスペクト比を維持し、長辺を上限に合わせる
      withoutEnlargement: true,
      // kernel は sharp 既定の lanczos3（縮小時のディテール保持が最も良い）
    })

    const out = await encodeSameFormat(pipeline, mimetype).toBuffer()
    return {
      bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
      resized: true,
      longEdge: MAX_IMAGE_LONG_EDGE,
    }
  } catch {
    // 画像が壊れて質問に答えられなくなる方が、原寸のまま送るコストより害が大きい
    return unchanged
  }
}

/** 形式は変換しない（JPEG→JPEG / PNG→PNG / WebP→WebP） */
function encodeSameFormat(pipeline: SharpPipeline, mimetype: string): SharpPipeline {
  switch (mimetype) {
    case 'image/jpeg':
      // chromaSubsampling 4:4:4 … 赤ペンの添削線など色付きの細線が滲まないようにする
      return pipeline.jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4' })
    case 'image/png':
      // PNG の符号化自体は可逆なので、縮小によるピクセル変化以外の圧縮劣化は無い。
      // ただし 16bit(ushort) PNG はこの経路で 8bit に落ちる（libvips の既定の出力深度）。
      // Vision 側が 8bit でしか受け取らない以上 16bit を保つ利得が無く、保持するとバイト数が
      // 約 2 倍になるだけなので、意図した挙動としてテストで固定している
      // （生徒が送るスマホ・教科書の写真は実質すべて 8bit で、16bit が来ること自体がまず無い）。
      return pipeline.png({ compressionLevel: 9 })
    default:
      return pipeline.webp({ quality: WEBP_QUALITY })
  }
}

function isResizableMimetype(mimetype: string): boolean {
  return mimetype === 'image/jpeg' || mimetype === 'image/png' || mimetype === 'image/webp'
}
