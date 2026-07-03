/** @file
 * 検証: 反応制御の判定ロジック
 * @verifies AC-02-01, AC-02-02, AC-02-03, AC-02-04, AC-02-05, AC-02-06
 */
import { describe, it, expect } from 'vitest'
import { shouldReact } from './shouldReact'
import type { ShouldReactInput } from '../types'

const base: ShouldReactInput = {
  hasBotId: false,
  subtype: undefined,
  text: 'こんにちは',
  hasMention: false,
  isThreadReply: false,
  bindingStatus: 'active',
  sessionExists: false,
}

describe('shouldReact', () => {
  it('チャンネル直下 + メンションあり + active → process（AC-02-01）', () => {
    expect(shouldReact({ ...base, hasMention: true }).action).toBe('process')
  })

  it('チャンネル直下 + メンションなし → ignore（AC-02-02）', () => {
    const d = shouldReact({ ...base, hasMention: false })
    expect(d.action).toBe('ignore')
  })

  it('登録済みスレッド内 + メンションなし → process（AC-02-03）', () => {
    expect(
      shouldReact({ ...base, isThreadReply: true, sessionExists: true, hasMention: false }).action,
    ).toBe('process')
  })

  it('未登録スレッド内 + メンションなし → ignore（AC-02-04）', () => {
    expect(
      shouldReact({ ...base, isThreadReply: true, sessionExists: false, hasMention: false }).action,
    ).toBe('ignore')
  })

  it('未登録スレッド内 + メンションあり → process（新規扱い）', () => {
    expect(
      shouldReact({ ...base, isThreadReply: true, sessionExists: false, hasMention: true }).action,
    ).toBe('process')
  })

  it('Bot 自身のメッセージ → ignore（AC-02-05）', () => {
    const d = shouldReact({ ...base, hasBotId: true, hasMention: true })
    expect(d.action).toBe('ignore')
    if (d.action === 'ignore') expect(d.reason).toBe('bot_message')
  })

  it('subtype 付き → ignore（BR-02-02）', () => {
    expect(shouldReact({ ...base, subtype: 'message_changed', hasMention: true }).action).toBe(
      'ignore',
    )
  })

  it('テキストなし → ignore（BR-02-06）', () => {
    expect(shouldReact({ ...base, text: undefined, hasMention: true }).action).toBe('ignore')
    expect(shouldReact({ ...base, text: '   ', hasMention: true }).action).toBe('ignore')
  })

  it('メンションありだが紐付けなし → channel_not_bound（AC-02-06）', () => {
    expect(shouldReact({ ...base, hasMention: true, bindingStatus: 'none' }).action).toBe(
      'channel_not_bound',
    )
  })

  it('メンションありだが紐付け inactive → channel_not_bound（BR-07-03）', () => {
    expect(shouldReact({ ...base, hasMention: true, bindingStatus: 'inactive' }).action).toBe(
      'channel_not_bound',
    )
  })

  it('登録済みスレッドでも binding が inactive なら channel_not_bound', () => {
    expect(
      shouldReact({
        ...base,
        isThreadReply: true,
        sessionExists: true,
        bindingStatus: 'inactive',
      }).action,
    ).toBe('channel_not_bound')
  })

  it('判定順: Bot メッセージは紐付けなしでも ignore が優先', () => {
    expect(
      shouldReact({ ...base, hasBotId: true, hasMention: true, bindingStatus: 'none' }).action,
    ).toBe('ignore')
  })
})
