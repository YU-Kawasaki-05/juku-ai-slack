/** @file
 * 機能: 画像ファイルのメタデータ（EXIF/GPS/XMP/IPTC/コメント）をバイト列レベルで除去する
 *   コンテナ（JPEG のマーカーセグメント / PNG のチャンク / WebP の RIFF チャンク）だけを操作し、
 *   ピクセルを保持する領域（JPEG のスキャンデータ・PNG の IDAT・WebP の VP8/VP8L）は 1 バイトも
 *   触らない。再エンコードしないため画質・ファイル内容は可逆的で劣化しない
 * 入力: bytes（ダウンロード直後の生バイト列）, mimetype（SUPPORTED_IMAGE_MIMETYPES）
 * 出力: { bytes, removedBytes }
 * 例外: なし。シグネチャ不一致・構造解析失敗時は元のバイト列をそのまま返す（フェイルセーフ）
 * 依存: なし（外部ライブラリ・ネイティブ依存なし）
 * 副作用: なし（純粋関数）
 * セキュリティ: 生徒が撮影した写真の位置情報（GPS）・端末情報・撮影日時が
 *   Storage 保存物および LLM 送信データに残らないようにする
 * @implements FR-06, BR-06-05
 */

export interface StripImageMetadataResult {
  /** メタデータ除去後のバイト列（除去できなかった場合は入力と同一インスタンス） */
  bytes: Uint8Array
  /** 除去できたバイト数。0 は「除去対象が無い」または「解析できず元データを返した」 */
  removedBytes: number
}

/**
 * 除去する JPEG マーカー。
 * 意図的に残すもの:
 *   APP0(0xE0) JFIF   … 解像度単位のみ。個人情報を含まない
 *   APP2(0xE2) ICC    … カラープロファイル。落とすと色再現が変わる＝画質に影響する
 *   APP14(0xEE) Adobe … CMYK/YCCK の色変換フラグ。落とすと復号結果が変わる
 */
const JPEG_STRIP_MARKERS = new Set<number>([
  0xe1, // APP1: EXIF（GPS・端末・撮影日時・サムネイル）/ XMP
  0xed, // APP13: Photoshop IRB（IPTC。作者・所在地・キャプション）
  0xfe, // COM: 任意コメント文字列
])

/** 除去する PNG チャンク。IHDR/PLTE/IDAT/IEND や表示品質に関わる補助チャンクは残す */
const PNG_STRIP_CHUNKS = new Set<string>([
  'tEXt', // 非圧縮テキスト（作者・コメント・生成ソフト）
  'zTXt', // 圧縮テキスト
  'iTXt', // 国際化テキスト（XMP はここに入る）
  'eXIf', // EXIF（GPS 含む）
  'tIME', // 最終更新日時
])

/** 除去する WebP チャンク。VP8/VP8L/VP8X/ALPH/ICCP/ANIM/ANMF は残す */
const WEBP_STRIP_CHUNKS = new Set<string>(['EXIF', 'XMP '])

/** VP8X フラグ: EXIF チャンクの存在ビット */
const VP8X_FLAG_EXIF = 0x08
/** VP8X フラグ: XMP チャンクの存在ビット */
const VP8X_FLAG_XMP = 0x04

const JPEG_SIGNATURE = [0xff, 0xd8] as const
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** 構造が想定外だったことを表す内部シグナル（呼び出し側で元データにフォールバックする） */
class MalformedImageError extends Error {}

export function stripImageMetadata(bytes: Uint8Array, mimetype: string): StripImageMetadataResult {
  const unchanged: StripImageMetadataResult = { bytes, removedBytes: 0 }
  try {
    const stripped = stripByFormat(bytes, mimetype)
    // 除去対象なし（同サイズ）、想定外に増えた場合はいずれも元データを採用する
    if (!stripped || stripped.byteLength >= bytes.byteLength) return unchanged
    return { bytes: stripped, removedBytes: bytes.byteLength - stripped.byteLength }
  } catch {
    // 画像が壊れて質問に答えられなくなる方が害が大きいため、常に元データを返す
    return unchanged
  }
}

/** 形式ごとの除去。対応外・シグネチャ不一致は null（＝元データを使う） */
function stripByFormat(bytes: Uint8Array, mimetype: string): Uint8Array | null {
  switch (mimetype) {
    case 'image/jpeg':
      return hasSignature(bytes, JPEG_SIGNATURE) ? stripJpeg(bytes) : null
    case 'image/png':
      return hasSignature(bytes, PNG_SIGNATURE) ? stripPng(bytes) : null
    case 'image/webp':
      return isWebp(bytes) ? stripWebp(bytes) : null
    default:
      return null
  }
}

function hasSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false
  return signature.every((b, i) => bytes[i] === b)
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
}

/**
 * JPEG: SOI から SOS までのマーカーセグメントを走査し、対象 APP/COM セグメントだけを落とす。
 * SOS 以降（エントロピー符号化されたピクセルデータ）は無検査でそのままコピーする。
 */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const len = bytes.byteLength
  const keep: Array<[number, number]> = [[0, 2]] // SOI
  let pos = 2
  let removed = 0

  while (pos < len) {
    if (bytes[pos] !== 0xff) throw new MalformedImageError('marker expected')
    // マーカー前の 0xFF 埋め（fill byte）を読み飛ばす
    let markerAt = pos
    while (markerAt < len && bytes[markerAt] === 0xff) markerAt += 1
    if (markerAt >= len) throw new MalformedImageError('truncated marker')
    const marker = bytes[markerAt]

    // 長さフィールドを持たないマーカー（TEM / RSTn / 予期しない SOI）
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      keep.push([pos, markerAt + 1])
      pos = markerAt + 1
      continue
    }
    // EOI / SOS 以降は解析せず末尾までそのまま残す（ピクセルデータを触らない）
    if (marker === 0xd9 || marker === 0xda) {
      keep.push([pos, len])
      pos = len
      break
    }

    if (markerAt + 3 > len) throw new MalformedImageError('truncated segment length')
    const segLen = (bytes[markerAt + 1] << 8) | bytes[markerAt + 2]
    if (segLen < 2) throw new MalformedImageError('invalid segment length')
    const segEnd = markerAt + 1 + segLen
    if (segEnd > len) throw new MalformedImageError('segment overruns file')

    if (JPEG_STRIP_MARKERS.has(marker)) {
      removed += segEnd - pos
    } else {
      keep.push([pos, segEnd])
    }
    pos = segEnd
  }

  if (removed === 0) return bytes
  return concatRanges(bytes, keep)
}

/** PNG: 8 バイトシグネチャ + チャンク列。メタデータチャンクのみ落とす（IDAT は不変） */
function stripPng(bytes: Uint8Array): Uint8Array {
  const len = bytes.byteLength
  const keep: Array<[number, number]> = [[0, 8]]
  let pos = 8
  let removed = 0

  while (pos < len) {
    if (pos + 12 > len) throw new MalformedImageError('truncated chunk header')
    const dataLen = readUint32BE(bytes, pos)
    // 4 バイト長 + 4 バイト型 + データ + 4 バイト CRC
    const chunkEnd = pos + 12 + dataLen
    if (dataLen > 0x7fffffff || chunkEnd > len) throw new MalformedImageError('chunk overruns file')
    const type = ascii(bytes, pos + 4, 4)

    if (PNG_STRIP_CHUNKS.has(type)) {
      removed += chunkEnd - pos
    } else {
      keep.push([pos, chunkEnd])
    }
    pos = chunkEnd

    if (type === 'IEND') {
      // IEND 以降の付加データは解析対象外。壊さないためそのまま残す
      if (pos < len) keep.push([pos, len])
      pos = len
      break
    }
  }

  if (removed === 0) return bytes
  return concatRanges(bytes, keep)
}

/**
 * WebP: RIFF コンテナの EXIF/XMP チャンクを落とし、RIFF サイズと VP8X の
 * メタデータ存在フラグを整合させる。VP8/VP8L（ピクセル）は不変。
 */
function stripWebp(bytes: Uint8Array): Uint8Array {
  const len = bytes.byteLength
  const declaredEnd = 8 + readUint32LE(bytes, 4)
  const end = Math.min(declaredEnd, len)
  if (end < 12) throw new MalformedImageError('invalid RIFF size')

  const parts: Uint8Array[] = []
  let pos = 12
  let removed = 0
  let vp8xFlagsIndex = -1 // parts 内の VP8X チャンク位置（フラグ更新用）

  while (pos < end) {
    if (pos + 8 > end) throw new MalformedImageError('truncated chunk header')
    const type = ascii(bytes, pos, 4)
    const dataLen = readUint32LE(bytes, pos + 4)
    // 奇数長のペイロードは 1 バイトのパディングが入る
    const padded = dataLen + (dataLen % 2)
    const chunkEnd = pos + 8 + padded
    if (dataLen > 0x7fffffff || chunkEnd > end) throw new MalformedImageError('chunk overruns file')

    if (WEBP_STRIP_CHUNKS.has(type)) {
      removed += chunkEnd - pos
    } else {
      if (type === 'VP8X') vp8xFlagsIndex = parts.length
      parts.push(bytes.subarray(pos, chunkEnd))
    }
    pos = chunkEnd
  }

  if (removed === 0) return bytes

  if (vp8xFlagsIndex >= 0) {
    // 落としたチャンクの存在ビットを消す（残すとデコーダが不整合と判断しうる）
    const original = parts[vp8xFlagsIndex]
    if (original.byteLength < 9) throw new MalformedImageError('invalid VP8X chunk')
    const copy = original.slice()
    copy[8] &= ~(VP8X_FLAG_EXIF | VP8X_FLAG_XMP)
    parts[vp8xFlagsIndex] = copy
  }

  const body = parts.reduce((sum, p) => sum + p.byteLength, 0)
  const out = new Uint8Array(12 + body)
  out.set(bytes.subarray(0, 12), 0)
  writeUint32LE(out, 4, out.byteLength - 8) // RIFF サイズ = 全体 - 8
  let offset = 12
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function concatRanges(bytes: Uint8Array, ranges: Array<[number, number]>): Uint8Array {
  const total = ranges.reduce((sum, [start, stop]) => sum + (stop - start), 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const [start, stop] of ranges) {
    out.set(bytes.subarray(start, stop), offset)
    offset += stop - start
  }
  return out
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let s = ''
  for (let i = 0; i < length; i += 1) s += String.fromCharCode(bytes[offset + i])
  return s
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  )
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    bytes[offset + 3] * 0x1000000
  )
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}
