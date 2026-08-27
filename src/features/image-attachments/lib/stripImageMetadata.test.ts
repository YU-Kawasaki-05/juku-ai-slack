/** @file
 * 検証: 画像メタデータ除去（EXIF/GPS 等）が「メタデータのみ落とし、ピクセルデータは 1 バイトも
 *   変えない」ことと、解析できないバイト列では元データをそのまま返すこと
 * @verifies FR-06, BR-06-05
 */
import { describe, it, expect } from 'vitest'
import { stripImageMetadata } from './stripImageMetadata'

// ---- テスト用バイト列ビルダ ----------------------------------------------

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.byteLength
  }
  return out
}

function asciiBytes(s: string): Uint8Array {
  return new Uint8Array([...s].map((c) => c.charCodeAt(0)))
}

/** JPEG のマーカーセグメント（FFxx + 2 バイト長 + ペイロード） */
function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.byteLength + 2
  return concat(new Uint8Array([0xff, marker, (len >> 8) & 0xff, len & 0xff]), payload)
}

const SOI = new Uint8Array([0xff, 0xd8])
const EOI = new Uint8Array([0xff, 0xd9])

/** JFIF ヘッダ（APP0）。個人情報を含まないので残る想定 */
const APP0_JFIF = jpegSegment(
  0xe0,
  concat(asciiBytes('JFIF\0'), new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])),
)

/** GPS 情報を含む体の EXIF（APP1） */
const APP1_EXIF = jpegSegment(
  0xe1,
  concat(
    asciiBytes('Exif\0\0'),
    // TIFF ヘッダ（リトルエンディアン）+ GPS らしいダミーペイロード
    new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
    asciiBytes('GPSLatitude 35.6812 GPSLongitude 139.7671 Make Apple iPhone'),
  ),
)

const APP2_ICC = jpegSegment(0xe2, concat(asciiBytes('ICC_PROFILE\0'), new Uint8Array([0x01, 0x01, 0xaa, 0xbb])))
const APP13_IPTC = jpegSegment(0xed, concat(asciiBytes('Photoshop 3.0\0'), asciiBytes('8BIM author=taro')))
const APP14_ADOBE = jpegSegment(0xee, concat(asciiBytes('Adobe'), new Uint8Array([0x64, 0x00, 0x00, 0x00, 0x00, 0x00])))
const COM = jpegSegment(0xfe, asciiBytes('created by camera app'))

/** 量子化テーブル・フレームヘッダ・ハフマンテーブル（画質を決めるので残らなければならない） */
const DQT = jpegSegment(0xdb, concat(new Uint8Array([0x00]), new Uint8Array(64).fill(0x10)))
const SOF0 = jpegSegment(
  0xc0,
  new Uint8Array([0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]),
)
const DHT = jpegSegment(0xc4, concat(new Uint8Array([0x00]), new Uint8Array(16).fill(0x00), new Uint8Array([0x00])))
/** SOS ヘッダ + エントロピー符号化データ（= ピクセルデータ。0xFF00 のスタッフバイトを含む） */
const SOS_AND_SCAN = concat(
  jpegSegment(0xda, new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
  new Uint8Array([0x12, 0x34, 0x56, 0x78, 0xff, 0x00, 0x9a, 0xbc]),
)

/** メタデータを一切含まない JPEG（除去後にこれと完全一致するのが理想） */
const JPEG_CLEAN = concat(SOI, APP0_JFIF, DQT, SOF0, DHT, SOS_AND_SCAN, EOI)

// ---- PNG --------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function uint32BE(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

/** PNG チャンク（長さ + 型 + データ + CRC32。CRC も実際に計算する） */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = concat(asciiBytes(type), data)
  return concat(uint32BE(data.byteLength), typeAndData, uint32BE(crc32(typeAndData)))
}

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const IHDR = pngChunk(
  'IHDR',
  new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 0x08, 0x02, 0x00, 0x00, 0x00]),
)
const IDAT = pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01]))
const IEND = pngChunk('IEND', new Uint8Array(0))
const SRGB = pngChunk('sRGB', new Uint8Array([0x00]))
const PNG_CLEAN = concat(PNG_SIG, IHDR, SRGB, IDAT, IEND)

// ---- WebP -------------------------------------------------------------

function uint32LE(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const pad = data.byteLength % 2 === 1 ? new Uint8Array([0x00]) : new Uint8Array(0)
  return concat(asciiBytes(fourcc), uint32LE(data.byteLength), data, pad)
}

function webp(...chunks: Uint8Array[]): Uint8Array {
  const body = concat(...chunks)
  return concat(asciiBytes('RIFF'), uint32LE(4 + body.byteLength), asciiBytes('WEBP'), body)
}

/** VP8X: flags(1) + reserved(3) + canvasW-1(3) + canvasH-1(3)。0x28 = ICC|EXIF */
function vp8x(flags: number): Uint8Array {
  return riffChunk('VP8X', new Uint8Array([flags, 0, 0, 0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
}

const VP8L_PIXELS = riffChunk('VP8L', new Uint8Array([0x2f, 0x00, 0x00, 0x00, 0x10, 0x88, 0x88, 0x08]))

// ---- テスト ------------------------------------------------------------

describe('stripImageMetadata / JPEG', () => {
  it('EXIF(APP1) を除去し、残りは元のクリーンな JPEG と 1 バイトも違わない', () => {
    const withExif = concat(SOI, APP0_JFIF, APP1_EXIF, DQT, SOF0, DHT, SOS_AND_SCAN, EOI)
    const r = stripImageMetadata(withExif, 'image/jpeg')

    expect(r.removedBytes).toBe(APP1_EXIF.byteLength)
    // メタデータ以外は完全に同一 → 再エンコードされていない＝画質不変の証明
    expect(Array.from(r.bytes)).toEqual(Array.from(JPEG_CLEAN))
  })

  it('GPS 文字列が除去後のバイト列に残らない', () => {
    const withExif = concat(SOI, APP0_JFIF, APP1_EXIF, DQT, SOF0, DHT, SOS_AND_SCAN, EOI)
    const r = stripImageMetadata(withExif, 'image/jpeg')
    const text = Buffer.from(r.bytes).toString('latin1')
    expect(text).not.toContain('GPSLatitude')
    expect(text).not.toContain('iPhone')
    expect(Buffer.from(withExif).toString('latin1')).toContain('GPSLatitude')
  })

  it('SOS 以降（ピクセルデータ）は完全に不変', () => {
    const withExif = concat(SOI, APP0_JFIF, APP1_EXIF, DQT, SOF0, DHT, SOS_AND_SCAN, EOI)
    const r = stripImageMetadata(withExif, 'image/jpeg')
    const sosIndex = (b: Uint8Array): number => {
      for (let i = 0; i < b.byteLength - 1; i += 1) if (b[i] === 0xff && b[i + 1] === 0xda) return i
      return -1
    }
    const before = withExif.subarray(sosIndex(withExif))
    const after = r.bytes.subarray(sosIndex(r.bytes))
    expect(sosIndex(r.bytes)).toBeGreaterThan(0)
    expect(Array.from(after)).toEqual(Array.from(before))
  })

  it('IPTC(APP13) と COM も除去する', () => {
    const withMeta = concat(SOI, APP0_JFIF, APP13_IPTC, COM, DQT, SOF0, DHT, SOS_AND_SCAN, EOI)
    const r = stripImageMetadata(withMeta, 'image/jpeg')
    expect(r.removedBytes).toBe(APP13_IPTC.byteLength + COM.byteLength)
    expect(Array.from(r.bytes)).toEqual(Array.from(JPEG_CLEAN))
  })

  it('ICC プロファイル(APP2) と Adobe マーカー(APP14) は残す（色再現＝画質に影響するため）', () => {
    const withIcc = concat(SOI, APP0_JFIF, APP2_ICC, APP1_EXIF, APP14_ADOBE, DQT, SOF0, DHT, SOS_AND_SCAN, EOI)
    const r = stripImageMetadata(withIcc, 'image/jpeg')
    const expected = concat(SOI, APP0_JFIF, APP2_ICC, APP14_ADOBE, DQT, SOF0, DHT, SOS_AND_SCAN, EOI)
    expect(Array.from(r.bytes)).toEqual(Array.from(expected))
    expect(Buffer.from(r.bytes).toString('latin1')).toContain('ICC_PROFILE')
  })

  it('メタデータが無い JPEG は入力インスタンスをそのまま返す', () => {
    const r = stripImageMetadata(JPEG_CLEAN, 'image/jpeg')
    expect(r.bytes).toBe(JPEG_CLEAN)
    expect(r.removedBytes).toBe(0)
  })
})

describe('stripImageMetadata / PNG', () => {
  it('tEXt/iTXt/eXIf/tIME を除去し、IHDR・sRGB・IDAT・IEND は不変', () => {
    const withMeta = concat(
      PNG_SIG,
      IHDR,
      pngChunk('tEXt', asciiBytes('Author\0taro')),
      SRGB,
      pngChunk('eXIf', asciiBytes('II*\0GPSLatitude')),
      pngChunk('iTXt', asciiBytes('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>')),
      pngChunk('tIME', new Uint8Array([0x07, 0xe6, 0x08, 0x1b, 0x0a, 0x00, 0x00])),
      IDAT,
      IEND,
    )
    const r = stripImageMetadata(withMeta, 'image/png')
    expect(r.removedBytes).toBe(withMeta.byteLength - PNG_CLEAN.byteLength)
    expect(Array.from(r.bytes)).toEqual(Array.from(PNG_CLEAN))
    expect(Buffer.from(r.bytes).toString('latin1')).not.toContain('GPSLatitude')
  })

  it('メタデータが無い PNG は入力インスタンスをそのまま返す', () => {
    const r = stripImageMetadata(PNG_CLEAN, 'image/png')
    expect(r.bytes).toBe(PNG_CLEAN)
    expect(r.removedBytes).toBe(0)
  })
})

describe('stripImageMetadata / WebP', () => {
  it('EXIF/XMP チャンクを除去し、RIFF サイズと VP8X フラグを整合させる', () => {
    const exif = riffChunk('EXIF', asciiBytes('II*\0GPSLatitude 35.6812'))
    const xmp = riffChunk('XMP ', asciiBytes('<x:xmpmeta>taro</x:xmpmeta>'))
    // 0x28 = ICC(0x20) | EXIF(0x08)、0x04 = XMP
    const original = webp(vp8x(0x20 | 0x08 | 0x04), VP8L_PIXELS, exif, xmp)
    const r = stripImageMetadata(original, 'image/webp')

    expect(r.removedBytes).toBe(exif.byteLength + xmp.byteLength)
    expect(Array.from(r.bytes)).toEqual(Array.from(webp(vp8x(0x20), VP8L_PIXELS)))
    // ICC フラグは維持、EXIF/XMP フラグは落ちている
    expect(r.bytes[20] & 0x20).toBe(0x20)
    expect(r.bytes[20] & 0x0c).toBe(0)
    // RIFF サイズ = 全体 - 8
    expect(r.bytes[4] + (r.bytes[5] << 8) + (r.bytes[6] << 16)).toBe(r.bytes.byteLength - 8)
    expect(Buffer.from(r.bytes).toString('latin1')).not.toContain('GPSLatitude')
  })

  it('ピクセルチャンク(VP8L)のバイト列は不変', () => {
    const original = webp(vp8x(0x08), VP8L_PIXELS, riffChunk('EXIF', asciiBytes('II*\0meta')))
    const r = stripImageMetadata(original, 'image/webp')
    const vp8lStart = Buffer.from(r.bytes).indexOf('VP8L', 0, 'latin1')
    expect(vp8lStart).toBeGreaterThan(0)
    expect(Array.from(r.bytes.subarray(vp8lStart, vp8lStart + VP8L_PIXELS.byteLength))).toEqual(
      Array.from(VP8L_PIXELS),
    )
  })

  it('メタデータが無い WebP は入力インスタンスをそのまま返す', () => {
    const original = webp(VP8L_PIXELS)
    const r = stripImageMetadata(original, 'image/webp')
    expect(r.bytes).toBe(original)
    expect(r.removedBytes).toBe(0)
  })
})

describe('stripImageMetadata / フェイルセーフ', () => {
  it('シグネチャが一致しないバイト列は元データをそのまま返す', () => {
    const junk = new Uint8Array([1, 2, 3])
    for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
      const r = stripImageMetadata(junk, mime)
      expect(r.bytes).toBe(junk)
      expect(r.removedBytes).toBe(0)
    }
  })

  it('空のバイト列でも例外を投げない', () => {
    const empty = new Uint8Array(0)
    expect(stripImageMetadata(empty, 'image/jpeg')).toEqual({ bytes: empty, removedBytes: 0 })
  })

  it('セグメント長がファイル外を指す壊れた JPEG は元データをそのまま返す', () => {
    // APP1 の長さが 0xFFFF だが実データはそれより短い
    const broken = concat(SOI, new Uint8Array([0xff, 0xe1, 0xff, 0xff, 0x00, 0x01]), EOI)
    const r = stripImageMetadata(broken, 'image/jpeg')
    expect(r.bytes).toBe(broken)
    expect(r.removedBytes).toBe(0)
  })

  it('マーカー境界が壊れた JPEG は元データをそのまま返す', () => {
    const broken = concat(SOI, new Uint8Array([0x12, 0x34, 0x56]), APP1_EXIF, EOI)
    const r = stripImageMetadata(broken, 'image/jpeg')
    expect(r.bytes).toBe(broken)
  })

  it('チャンク長がファイル外を指す壊れた PNG は元データをそのまま返す', () => {
    const broken = concat(PNG_SIG, uint32BE(0x7ffffff0), asciiBytes('tEXt'), new Uint8Array(8))
    const r = stripImageMetadata(broken, 'image/png')
    expect(r.bytes).toBe(broken)
    expect(r.removedBytes).toBe(0)
  })

  it('チャンク長がファイル外を指す壊れた WebP は元データをそのまま返す', () => {
    const broken = concat(
      asciiBytes('RIFF'),
      uint32LE(1000),
      asciiBytes('WEBP'),
      asciiBytes('EXIF'),
      uint32LE(900),
      new Uint8Array(4),
    )
    const r = stripImageMetadata(broken, 'image/webp')
    expect(r.bytes).toBe(broken)
    expect(r.removedBytes).toBe(0)
  })

  it('対応外 MIME は解析せず元データをそのまま返す', () => {
    const withExif = concat(SOI, APP1_EXIF, DQT, SOF0, DHT, SOS_AND_SCAN, EOI)
    const r = stripImageMetadata(withExif, 'image/gif')
    expect(r.bytes).toBe(withExif)
    expect(r.removedBytes).toBe(0)
  })
})
