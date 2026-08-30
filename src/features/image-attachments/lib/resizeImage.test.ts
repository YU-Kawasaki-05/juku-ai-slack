/** @file
 * 検証: 送信前の長辺キャップ。上限超のみを縮小し、上限以下は 1 バイトも変えないこと、
 *   アスペクト比・形式が維持されること、壊れた入力で例外を投げないこと、
 *   縮小経路でも EXIF/GPS が残らないこと
 * @verifies FR-06, BR-06-05
 */
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { resizeImage } from './resizeImage'
import { MAX_IMAGE_LONG_EDGE } from '@shared/lib/constants'

type Format = 'jpeg' | 'png' | 'webp'

const MIME: Record<Format, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** テスト用の絵柄付き画像。合成画像はバイト数の比率が実写と乖離するため、検証はピクセル寸法で行う */
async function makeImage(width: number, height: number, format: Format): Promise<Uint8Array> {
  const channels = 3
  const raw = Buffer.alloc(width * height * channels)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels
      // 写真に近い低周波の絵柄（高周波ノイズだと縮小後の方が重くなり、実際の傾向とずれる）
      const block = ((x >> 6) ^ (y >> 6)) & 1
      raw[i] = Math.round((x / width) * 255)
      raw[i + 1] = Math.round((y / height) * 255)
      raw[i + 2] = block ? 210 : 45
    }
  }
  const buf = await sharp(raw, { raw: { width, height, channels } })[format]().toBuffer()
  return new Uint8Array(buf)
}

async function dimensions(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}

describe('resizeImage', () => {
  it('長辺が上限を超える画像は長辺 2048 に縮小し、アスペクト比を維持する', async () => {
    const input = await makeImage(3024, 4032, 'jpeg') // スマホ縦写真
    const r = await resizeImage(input, 'image/jpeg')

    expect(r.resized).toBe(true)
    const { width, height } = await dimensions(r.bytes)
    expect(Math.max(width, height)).toBe(MAX_IMAGE_LONG_EDGE)
    expect(height).toBe(MAX_IMAGE_LONG_EDGE)
    // 3024:4032 = 3:4 → 1536x2048
    expect(width).toBe(1536)
  })

  it('横長画像でも長辺（幅）が 2048 になる', async () => {
    const input = await makeImage(4000, 1000, 'jpeg')
    const r = await resizeImage(input, 'image/jpeg')

    expect(r.resized).toBe(true)
    const { width, height } = await dimensions(r.bytes)
    expect(width).toBe(MAX_IMAGE_LONG_EDGE)
    expect(height).toBe(512)
  })

  it('長辺が上限以下の画像は 1 バイトも変更しない', async () => {
    const input = await makeImage(1600, 1200, 'jpeg')
    const r = await resizeImage(input, 'image/jpeg')

    expect(r.resized).toBe(false)
    expect(r.bytes).toBe(input) // 同一インスタンス＝再エンコードしていない
    expect(Buffer.from(r.bytes).equals(Buffer.from(input))).toBe(true)
  })

  it('長辺がちょうど上限の画像も縮小しない（境界）', async () => {
    const input = await makeImage(MAX_IMAGE_LONG_EDGE, 1000, 'jpeg')
    const r = await resizeImage(input, 'image/jpeg')

    expect(r.resized).toBe(false)
    expect(r.bytes).toBe(input)
  })

  it.each<Format>(['jpeg', 'png', 'webp'])('%s は縮小後も同じ形式のまま（形式変換しない）', async (format) => {
    const input = await makeImage(3000, 2000, format)
    const r = await resizeImage(input, MIME[format])

    expect(r.resized).toBe(true)
    const meta = await sharp(r.bytes).metadata()
    expect(meta.format).toBe(format)
    expect(meta.width).toBe(MAX_IMAGE_LONG_EDGE)
  })

  it('縮小した画像に EXIF/GPS が残らない', async () => {
    const base = await makeImage(3000, 2000, 'jpeg')
    const withExif = new Uint8Array(
      await sharp(base)
        .withExif({
          IFD0: { Make: 'Apple', Model: 'iPhone-SECRET-MODEL', Artist: 'student-name' },
          // sharp は IFD3 を GPSInfo にマップする
          IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E', GPSLatitude: '35/1 40/1 52/1' },
        })
        .jpeg()
        .toBuffer(),
    )
    // 前提: 入力には EXIF が入っている
    expect((await sharp(withExif).metadata()).exif).toBeDefined()
    expect(Buffer.from(withExif).toString('latin1')).toContain('iPhone-SECRET-MODEL')

    const r = await resizeImage(withExif, 'image/jpeg')

    expect(r.resized).toBe(true)
    expect((await sharp(r.bytes).metadata()).exif).toBeUndefined()
    const text = Buffer.from(r.bytes).toString('latin1')
    expect(text).not.toContain('iPhone-SECRET-MODEL')
    expect(text).not.toContain('student-name')
    expect(text).not.toContain('Exif')
  })

  it('壊れた画像は例外を投げず元データをそのまま返す', async () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3, 4, 5])
    const r = await resizeImage(broken, 'image/jpeg')

    expect(r.resized).toBe(false)
    expect(r.bytes).toBe(broken)
  })

  it('画像ですらないバイト列でも例外を投げない', async () => {
    const notImage = new Uint8Array([1, 2, 3])
    const r = await resizeImage(notImage, 'image/png')

    expect(r.resized).toBe(false)
    expect(r.bytes).toBe(notImage)
  })

  it('対応外 MIME は触らない', async () => {
    const input = await makeImage(3000, 2000, 'png')
    const r = await resizeImage(input, 'image/gif')

    expect(r.resized).toBe(false)
    expect(r.bytes).toBe(input)
  })

  it('総ピクセル数が減る（トークン数は解像度に比例するのでここがコスト削減の実体）', async () => {
    const input = await makeImage(3024, 4032, 'jpeg')
    const r = await resizeImage(input, 'image/jpeg')

    const before = 3024 * 4032
    const { width, height } = await dimensions(r.bytes)
    // 12.2M px → 3.1M px。トークンはピクセル数に比例するので約 14300 → 約 3700 トークン相当
    expect(width * height).toBeLessThan(before / 3)
  })
})
