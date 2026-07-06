/** @file
 * 検証: チャンネル紐付け入力バリデーション
 * @verifies AC-15-01
 */
import { describe, it, expect } from 'vitest'
import { bindingCreateSchema, bindingUpdateSchema } from './bindingSchema'

const UUID = '00000000-0000-0000-0000-000000000001'

describe('bindingCreateSchema', () => {
  it('team/channel/person 必須、status デフォルト active', () => {
    const r = bindingCreateSchema.safeParse({
      slackTeamId: 'T1',
      slackChannelId: 'C1',
      slackChannelName: 'study-taro',
      personId: UUID,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.status).toBe('active')
  })

  it('personId が UUID でないとエラー', () => {
    expect(
      bindingCreateSchema.safeParse({ slackTeamId: 'T1', slackChannelId: 'C1', personId: 'x' }).success,
    ).toBe(false)
  })

  it('channelId 空はエラー', () => {
    expect(
      bindingCreateSchema.safeParse({ slackTeamId: 'T1', slackChannelId: '', personId: UUID }).success,
    ).toBe(false)
  })
})

describe('bindingUpdateSchema', () => {
  it('id + status を検証（channelId は含めない=変更不可 BR-15-01）', () => {
    const r = bindingUpdateSchema.safeParse({ id: UUID, status: 'inactive', slackChannelName: 'new' })
    expect(r.success).toBe(true)
    expect('slackChannelId' in (r.success ? r.data : {})).toBe(false)
  })
})
