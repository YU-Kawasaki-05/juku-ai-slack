/** @file
 * 検証: チャンネル紐付け入力バリデーション（必須・長さ上限・Slack ID 形式）
 * @verifies AC-15-01, H-7
 */
import { describe, it, expect } from 'vitest'
import { bindingCreateSchema, bindingUpdateSchema } from './bindingSchema'

const UUID = '00000000-0000-0000-0000-000000000001'
const TEAM_ID = 'T01ABCDEFGH'
const CHANNEL_ID = 'C01ABCDEFGH'

function create(overrides: Record<string, unknown> = {}) {
  return bindingCreateSchema.safeParse({
    slackTeamId: TEAM_ID,
    slackChannelId: CHANNEL_ID,
    personId: UUID,
    ...overrides,
  })
}

describe('bindingCreateSchema', () => {
  it('team/channel/person 必須、status デフォルト active', () => {
    const r = create({ slackChannelName: 'study-taro' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.status).toBe('active')
  })

  it('personId が UUID でないとエラー', () => {
    expect(create({ personId: 'x' }).success).toBe(false)
  })

  it('channelId 空はエラー', () => {
    expect(create({ slackChannelId: '' }).success).toBe(false)
  })

  it.each(['C01ABCDEFGH', 'GABCDEF123', 'D0123456789'])(
    'チャンネルID %s（C/G/D 始まり）は許可',
    (id) => {
      expect(create({ slackChannelId: id }).success).toBe(true)
    },
  )

  it.each([
    ['小文字を含む', 'c01abcdefgh'],
    ['先頭文字が対象外', 'X01ABCDEFGH'],
    ['プレフィックスのみ', 'C'],
    ['記号混入', 'C01-ABC'],
    ['URL 混入', 'https://example.com/C01ABCDEFGH'],
  ])('チャンネルID: %s はエラー', (_label, id) => {
    const r = create({ slackChannelId: id })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('チャンネルID'))).toBe(true)
    }
  })

  it('チャンネルIDが 50 文字超はエラー', () => {
    expect(create({ slackChannelId: 'C' + 'A'.repeat(50) }).success).toBe(false)
  })

  it.each([
    ['T 始まりでない', 'X01ABCDEFGH'],
    ['小文字', 't01abcdefgh'],
    ['T のみ', 'T'],
  ])('ワークスペースID: %s はエラー', (_label, id) => {
    const r = create({ slackTeamId: id })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('ワークスペースID'))).toBe(true)
    }
  })

  it('チャンネル名は 200 文字まで、201 文字はエラー', () => {
    expect(create({ slackChannelName: 'あ'.repeat(200) }).success).toBe(true)
    const r = create({ slackChannelName: 'あ'.repeat(201) })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0].message).toBe('チャンネル名は200文字以内で入力してください')
    }
  })

  it('チャンネル名の空文字・空白のみは null に正規化される', () => {
    const r = create({ slackChannelName: '   ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.slackChannelName).toBeNull()
  })

  it('前後の空白は trim される', () => {
    const r = create({ slackChannelId: `  ${CHANNEL_ID}  `, slackChannelName: '  study-taro  ' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.slackChannelId).toBe(CHANNEL_ID)
      expect(r.data.slackChannelName).toBe('study-taro')
    }
  })
})

describe('bindingCreateSchema: defaultReportId（H-11）', () => {
  const REPORT_ID = '33333333-3333-4333-8333-333333333333'

  it.each([
    ['未指定', undefined],
    ['none センチネル', 'none'],
    ['空文字', ''],
  ])('%s は null に正規化される', (_label, value) => {
    const r = create({ defaultReportId: value })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.defaultReportId).toBeNull()
  })

  it('UUID はそのまま通る', () => {
    const r = create({ defaultReportId: REPORT_ID })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.defaultReportId).toBe(REPORT_ID)
  })

  it('UUID でない値はエラー', () => {
    const r = create({ defaultReportId: 'not-a-uuid' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.') === 'defaultReportId')).toBe(true)
    }
  })
})

describe('bindingUpdateSchema', () => {
  it('id + status を検証（channelId は含めない=変更不可 BR-15-01）', () => {
    const r = bindingUpdateSchema.safeParse({ id: UUID, status: 'inactive', slackChannelName: 'new' })
    expect(r.success).toBe(true)
    expect('slackChannelId' in (r.success ? r.data : {})).toBe(false)
  })

  it('チャンネル名 201 文字はエラー（H-7）', () => {
    const r = bindingUpdateSchema.safeParse({
      id: UUID,
      status: 'active',
      slackChannelName: 'x'.repeat(201),
    })
    expect(r.success).toBe(false)
  })
})
