/** @file
 * 検証: 管理画面 URL クエリの検証（不正値を 500 にせずフィルタなしへ倒す）
 * @verifies H-4
 */
import { describe, it, expect } from 'vitest'
import { isUuid, parseUuidParam, parseMonthParam, parsePageParam } from './searchParams'

describe('parseUuidParam', () => {
  it('完全形の UUID は通す（大文字小文字は問わない）', () => {
    expect(parseUuidParam('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
    expect(parseUuidParam('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE')).toBeTruthy()
  })

  it('ハイフンだけの 36 文字は弾く（旧 regex が通して 22P02 で 500 になっていたケース）', () => {
    expect(parseUuidParam('-'.repeat(36))).toBeUndefined()
  })

  it('桁数・区切り位置が違うものは弾く', () => {
    expect(parseUuidParam('1111111-11111-4111-8111-111111111111')).toBeUndefined()
    expect(parseUuidParam('11111111111141118111111111111111')).toBeUndefined()
    expect(parseUuidParam('11111111-1111-4111-8111-11111111111')).toBeUndefined()
  })

  it('16進数以外・未指定は弾く', () => {
    expect(parseUuidParam('zzzzzzzz-1111-4111-8111-111111111111')).toBeUndefined()
    expect(parseUuidParam(undefined)).toBeUndefined()
    expect(parseUuidParam('')).toBeUndefined()
  })

  it('isUuid は型ガードとして同じ判定をする', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
  })
})

describe('parseMonthParam', () => {
  it('YYYY-MM を通す', () => {
    expect(parseMonthParam('2026-01')).toBe('2026-01')
    expect(parseMonthParam('2026-12')).toBe('2026-12')
  })

  it('存在しない月は弾く（旧 regex は 2026-99 を通していた）', () => {
    expect(parseMonthParam('2026-00')).toBeUndefined()
    expect(parseMonthParam('2026-13')).toBeUndefined()
    expect(parseMonthParam('2026-99')).toBeUndefined()
  })

  it('形式違い・未指定は弾く', () => {
    expect(parseMonthParam('2026-1')).toBeUndefined()
    expect(parseMonthParam('2026/01')).toBeUndefined()
    expect(parseMonthParam(undefined)).toBeUndefined()
  })
})

describe('parsePageParam', () => {
  it('正の整数を返す', () => {
    expect(parsePageParam('3')).toBe(3)
  })

  it('未指定・不正値・0 は 1 に倒す', () => {
    expect(parsePageParam(undefined)).toBe(1)
    expect(parsePageParam('0')).toBe(1)
    expect(parsePageParam('-2')).toBe(1)
    expect(parsePageParam('abc')).toBe(1)
    expect(parsePageParam('1e9')).toBe(1)
  })
})
