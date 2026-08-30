/** @file
 * 検証: 送信前の長辺キャップ。上限超のみを縮小し、上限以下は 1 バイトも変えないこと、
 *   アスペクト比・形式が維持されること、壊れた入力で例外を投げないこと、
 *   縮小経路でも EXIF/GPS が残らないこと、および再エンコードの画質設定
 *   （JPEG quality 85 / chromaSubsampling 4:4:4、WebP quality 85、PNG の可逆性）が
 *   黙って下がらないこと。画質は「数式・鉛筆の細線・小さな添え字の判読性」そのものなので、
 *   劣化しても CI が気づけない状態を作らない。
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

/** 実装と同じ縮小指定。参照エンコードを作るときだけ使う */
const RESIZE = {
  width: MAX_IMAGE_LONG_EDGE,
  height: MAX_IMAGE_LONG_EDGE,
  fit: 'inside',
  withoutEnlargement: true,
} as const

/**
 * JPEG の量子化テーブル（DQT セグメント）を hex で取り出す。
 * libjpeg のテーブルは quality から一意に決まり、画像の内容にも寸法にも
 * chromaSubsampling にも依存しないので、出力バイト列だけから「どの quality で
 * 符号化されたか」を判定できる。
 */
function quantizationTables(bytes: Uint8Array): string {
  const b = Buffer.from(bytes)
  const tables: string[] = []
  let i = 2 // SOI の次から
  while (i < b.length - 3) {
    if (b[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = b[i + 1]
    // パラメータを持たないマーカー（fill byte / TEM / RSTn）
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2
      continue
    }
    if (marker === 0xda) break // SOS 以降はエントロピー符号化データ
    const length = b.readUInt16BE(i + 2)
    if (marker === 0xdb) tables.push(b.subarray(i + 4, i + 2 + length).toString('hex'))
    i += 2 + length
  }
  return tables.join('|')
}

/** quality だけを変えた参照テーブル。内容非依存なので 8x8 のダミーで足りる */
async function referenceQuantizationTables(quality: number): Promise<string> {
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg({ quality })
    .toBuffer()
  return quantizationTables(new Uint8Array(buf))
}

/**
 * 実装と同じ縮小を行い quality だけを変えた WebP 参照エンコード。
 * WebP には JPEG の量子化テーブルのような内容非依存の指紋が無いため、出力バイト列そのもので固定する。
 * 参照は同一プロセスの同じ sharp が作るので sharp を上げても両辺が同時に動く（＝版差では壊れない）が、
 * 実装側で縮小指定を変えたら RESIZE も合わせる必要がある。
 */
async function referenceWebp(input: Uint8Array, quality: number): Promise<Buffer> {
  return sharp(input, { failOn: 'error', animated: false }).resize(RESIZE).webp({ quality }).toBuffer()
}

/** 16bit(ushort) PNG。実運用ではまず来ないが、縮小時に 8bit へ落ちる挙動を固定するために使う */
async function make16BitPng(width: number, height: number): Promise<Uint8Array> {
  const channels = 3
  const raw = Buffer.alloc(width * height * channels)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels
      raw[i] = Math.round((x / width) * 255)
      raw[i + 1] = Math.round((y / height) * 255)
      raw[i + 2] = ((x >> 6) ^ (y >> 6)) & 1 ? 210 : 45
    }
  }
  const buf = await sharp(raw, { raw: { width, height, channels } })
    .toColourspace('rgb16') // libvips の出力深度が ushort になり 16bit PNG が書かれる
    .png()
    .toBuffer()
  return new Uint8Array(buf)
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

  it('JPEG は quality 85 で再エンコードする（量子化テーブルで固定）', async () => {
    const input = await makeImage(3000, 2000, 'jpeg')
    const r = await resizeImage(input, 'image/jpeg')

    expect(r.resized).toBe(true)
    const actual = quantizationTables(r.bytes)
    expect(actual).not.toBe('') // テーブルを読めていない状態で通過させない
    expect(actual).toBe(await referenceQuantizationTables(85))
    // 判定が quality に反応していることの担保（±1 でも別テーブルになる）
    expect(actual).not.toBe(await referenceQuantizationTables(30))
    expect(actual).not.toBe(await referenceQuantizationTables(84))
    expect(actual).not.toBe(await referenceQuantizationTables(86))
  })

  it('JPEG は chromaSubsampling 4:4:4 のまま（赤ペンなど色付きの細線を滲ませない）', async () => {
    const input = await makeImage(3000, 2000, 'jpeg')
    const r = await resizeImage(input, 'image/jpeg')

    expect(r.resized).toBe(true)
    expect((await sharp(r.bytes).metadata()).chromaSubsampling).toBe('4:4:4')
    // 判定が効いていることの担保: 4:2:0 で符号化すれば metadata もそう報告する
    const subsampled = await sharp(input).jpeg({ chromaSubsampling: '4:2:0' }).toBuffer()
    expect((await sharp(subsampled).metadata()).chromaSubsampling).toBe('4:2:0')
  })

  it('WebP は quality 85 で再エンコードする（参照エンコードとのバイト一致で固定）', async () => {
    const input = await makeImage(3000, 2000, 'webp')
    const r = await resizeImage(input, 'image/webp')

    expect(r.resized).toBe(true)
    expect(Buffer.from(r.bytes).equals(await referenceWebp(input, 85))).toBe(true)
    // 判定が quality に反応していることの担保
    expect(Buffer.from(r.bytes).equals(await referenceWebp(input, 84))).toBe(false)
    expect(Buffer.from(r.bytes).equals(await referenceWebp(input, 30))).toBe(false)
  })

  it('PNG 経路は可逆（縮小後のピクセルが 1 サンプルも変わらない）', async () => {
    const input = await makeImage(3000, 2000, 'png')
    const r = await resizeImage(input, 'image/png')

    expect(r.resized).toBe(true)
    // compressionLevel はサイズだけの設定なので固定しない。守るのは「非可逆な符号化を混ぜないこと」
    const expected = await sharp(input, { failOn: 'error', animated: false }).resize(RESIZE).raw().toBuffer()
    const actual = await sharp(r.bytes).raw().toBuffer()
    expect(actual.equals(expected)).toBe(true)
  })

  it('16bit PNG は縮小すると 8bit に落ちる（既知かつ許容した挙動）', async () => {
    const input = await make16BitPng(2400, 200)
    // 前提: 入力は 16bit
    expect((await sharp(input).metadata()).depth).toBe('ushort')

    const r = await resizeImage(input, 'image/png')

    expect(r.resized).toBe(true)
    expect((await sharp(r.bytes).metadata()).depth).toBe('uchar')

    // 劣化するのは再エンコード経路だけ。上限以下なら 16bit のまま素通しされる
    const small = await make16BitPng(1000, 200)
    const rSmall = await resizeImage(small, 'image/png')
    expect(rSmall.resized).toBe(false)
    expect(rSmall.bytes).toBe(small)
    expect((await sharp(rSmall.bytes).metadata()).depth).toBe('ushort')
  })
})
