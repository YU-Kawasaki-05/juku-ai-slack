/** @file
 * 検証: cron 認証（Bearer CRON_SECRET）。ヘッダなし・違う・正しい・シークレット未設定
 * @verifies FR-08
 */
import { describe, it, expect } from 'vitest'
import { verifyCronAuth } from './cronAuth'

describe('verifyCronAuth', () => {
  it('Authorization ヘッダが無ければ拒否', () => {
    expect(verifyCronAuth(null, 's3cret')).toBe(false)
    expect(verifyCronAuth(undefined, 's3cret')).toBe(false)
    expect(verifyCronAuth('', 's3cret')).toBe(false)
  })

  it('シークレットが違えば拒否（長さが違っても例外にならない）', () => {
    expect(verifyCronAuth('Bearer wrong', 's3cret')).toBe(false)
    expect(verifyCronAuth('Bearer s3cret-but-longer', 's3cret')).toBe(false)
    expect(verifyCronAuth('Bearer s3cre', 's3cret')).toBe(false)
  })

  it('Bearer 以外の形式は拒否', () => {
    expect(verifyCronAuth('s3cret', 's3cret')).toBe(false)
    expect(verifyCronAuth('Basic s3cret', 's3cret')).toBe(false)
  })

  it('正しい Bearer なら許可', () => {
    expect(verifyCronAuth('Bearer s3cret', 's3cret')).toBe(true)
  })

  it('シークレット未設定・空は、どんなヘッダでも拒否する（fail-open にしない）', () => {
    expect(verifyCronAuth('Bearer ', '')).toBe(false)
    expect(verifyCronAuth('Bearer undefined', undefined)).toBe(false)
    expect(verifyCronAuth('Bearer null', null)).toBe(false)
    expect(verifyCronAuth('Bearer ', '   ')).toBe(false)
  })
})
