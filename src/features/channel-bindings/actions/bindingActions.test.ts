/** @file
 * 検証: チャンネル紐付け Server Action の認証ガード・重複検知・更新
 * @verifies AC-15-01, AC-15-02, AC-15-03
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'

vi.mock('@shared/lib/auth/requireStaff', () => ({ requireStaff: vi.fn() }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createBindingAction, updateBindingAction } from './bindingActions'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { createServerClient } from '@shared/lib/supabase/serverClient'

const PERSON_ID = '11111111-1111-4111-8111-111111111111'
const BINDING_ID = '44444444-4444-4444-8444-444444444444'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

const staffOk = () => vi.mocked(requireStaff).mockResolvedValue({ userId: 'u1', email: 'a@b.com' })

beforeEach(() => vi.clearAllMocks())

describe('createBindingAction', () => {
  it('未認証はログイン要求（throw しない）', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('unauthorized'))
    const r = await createBindingAction(undefined, fd({ slackTeamId: 'T1', slackChannelId: 'C1', personId: PERSON_ID }))
    expect(r).toEqual({ ok: false, error: 'ログインが必要です' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('正常時は生徒名スナップショット付きで insert', async () => {
    staffOk()
    const db = createMockDb({
      maybeSingle: { data: { name: '太郎' }, error: null },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await createBindingAction(undefined, fd({ slackTeamId: 'T1', slackChannelId: 'C1', personId: PERSON_ID }))
    expect(r).toEqual({ ok: true })
    expect(db.__calls.insert[0]).toMatchObject({
      slack_channel_id: 'C1',
      person_id: PERSON_ID,
      person_name_snapshot: '太郎',
    })
  })

  it('チャンネル重複は専用メッセージ（AC-15-03）', async () => {
    staffOk()
    vi.mocked(createServerClient).mockReturnValue(
      createMockDb({ maybeSingle: { data: { name: '太郎' }, error: null }, thenable: { error: { code: '23505' } } }),
    )
    const r = await createBindingAction(undefined, fd({ slackTeamId: 'T1', slackChannelId: 'C1', personId: PERSON_ID }))
    expect(r).toEqual({ ok: false, error: 'このチャンネルはすでに紐付けされています' })
  })
})

describe('updateBindingAction', () => {
  it('正常時は name/status のみ更新（channel_id は不変, BR-15-01）', async () => {
    staffOk()
    const db = createMockDb({ thenable: { error: null } })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await updateBindingAction(undefined, fd({ id: BINDING_ID, slackChannelName: 'study-taro', status: 'inactive' }))
    expect(r).toEqual({ ok: true })
    const updated = db.__calls.update[0] as Record<string, unknown>
    expect(updated).toMatchObject({ slack_channel_name: 'study-taro', status: 'inactive' })
    expect(updated).not.toHaveProperty('slack_channel_id')
  })
})
