/** @file
 * 検証: Slack スレッド URL の組み立て
 * @verifies AC-17-01（SCR-12 スレッドリンク）
 */
import { describe, it, expect } from 'vitest'
import { buildSlackThreadUrl } from './slackThreadUrl'

describe('buildSlackThreadUrl', () => {
  it('archives 形式の URL を組み立てる（ts のドット除去・末尾スラッシュ正規化）', () => {
    expect(
      buildSlackThreadUrl('https://example.slack.com', 'C0123ABC', '1718000000.123456'),
    ).toBe('https://example.slack.com/archives/C0123ABC/p1718000000123456')
    expect(
      buildSlackThreadUrl('https://example.slack.com/', 'C0123ABC', '1718000000.123456'),
    ).toBe('https://example.slack.com/archives/C0123ABC/p1718000000123456')
  })

  it('材料が欠けている・ts が不正なら null（リンク非表示）', () => {
    expect(buildSlackThreadUrl(undefined, 'C0123ABC', '1718000000.123456')).toBeNull()
    expect(buildSlackThreadUrl('https://example.slack.com', null, '1718000000.123456')).toBeNull()
    expect(buildSlackThreadUrl('https://example.slack.com', 'C0123ABC', null)).toBeNull()
    expect(buildSlackThreadUrl('https://example.slack.com', 'C0123ABC', 'not-a-ts')).toBeNull()
  })
})
