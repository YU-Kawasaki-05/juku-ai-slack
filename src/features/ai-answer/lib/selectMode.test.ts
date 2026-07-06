/** @file
 * 検証: P(mastery) 3モード判定
 * @verifies AC-05-02, AC-05-03, AC-05-05
 */
import { describe, it, expect } from 'vitest'
import { selectMode } from './selectMode'

describe('selectMode', () => {
  it('P < 0.3 は direct（AC-05-02）', () => {
    expect(selectMode({ pMastery: 0.2, examMode: false })).toBe('direct')
    expect(selectMode({ pMastery: 0.0, examMode: false })).toBe('direct')
    expect(selectMode({ pMastery: 0.29, examMode: false })).toBe('direct')
  })

  it('0.3 ≤ P < 0.8 は socratic（AC-05-03）', () => {
    expect(selectMode({ pMastery: 0.3, examMode: false })).toBe('socratic')
    expect(selectMode({ pMastery: 0.55, examMode: false })).toBe('socratic')
    expect(selectMode({ pMastery: 0.79, examMode: false })).toBe('socratic')
  })

  it('P ≥ 0.8 は confirmation', () => {
    expect(selectMode({ pMastery: 0.8, examMode: false })).toBe('confirmation')
    expect(selectMode({ pMastery: 1.0, examMode: false })).toBe('confirmation')
  })

  it('試験前モードは P 値によらず direct（AC-05-05, BR-05-08）', () => {
    expect(selectMode({ pMastery: 0.7, examMode: true })).toBe('direct')
    expect(selectMode({ pMastery: 0.95, examMode: true })).toBe('direct')
  })
})
