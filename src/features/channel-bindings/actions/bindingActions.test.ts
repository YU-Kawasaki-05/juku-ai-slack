/** @file
 * 検証: チャンネル紐付け Server Action の認可（admin 専用）・重複検知・更新・再検証パス
 * @verifies AC-15-01, AC-15-02, AC-15-03, EP-07〜09（admin 専用）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'

vi.mock('@shared/lib/auth/requireAdmin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createBindingAction, updateBindingAction } from './bindingActions'
import { requireAdmin } from '@shared/lib/auth/requireAdmin'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { revalidatePath } from 'next/cache'

const PERSON_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_PERSON_ID = '22222222-2222-4222-8222-222222222222'
const REPORT_ID = '33333333-3333-4333-8333-333333333333'
const BINDING_ID = '44444444-4444-4444-8444-444444444444'
const TEAM_ID = 'T01ABCDEFGH'
const CHANNEL_ID = 'C01ABCDEFGH'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

const adminOk = () => vi.mocked(requireAdmin).mockResolvedValue({ userId: 'u1', email: 'a@b.com', role: 'admin' })

beforeEach(() => vi.clearAllMocks())

describe('createBindingAction', () => {
  it('未認証はログイン要求（throw しない）', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('unauthorized'))
    const r = await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: CHANNEL_ID, personId: PERSON_ID }),
    )
    expect(r).toEqual({ ok: false, error: 'ログインが必要です' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('staff（admin 以外）は forbidden で拒否される（EP-08 は admin 専用）', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('forbidden'))
    const r = await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: CHANNEL_ID, personId: PERSON_ID }),
    )
    expect(r).toEqual({ ok: false, error: 'この操作は管理者のみ実行できます' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('正常時は生徒名スナップショット付きで insert', async () => {
    adminOk()
    const db = createMockDb({
      maybeSingle: { data: { name: '太郎' }, error: null },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: CHANNEL_ID, personId: PERSON_ID }),
    )
    expect(r).toEqual({ ok: true })
    expect(db.__calls.insert[0]).toMatchObject({
      slack_channel_id: CHANNEL_ID,
      person_id: PERSON_ID,
      person_name_snapshot: '太郎',
    })
  })

  it('生徒名の読み取り失敗は insert せずエラーを返す（黙って null 保存しない）', async () => {
    adminOk()
    const db = createMockDb({
      maybeSingle: { data: null, error: { message: 'connection reset' } },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: CHANNEL_ID, personId: PERSON_ID }),
    )
    expect(r).toEqual({ ok: false, error: '生徒情報の取得に失敗しました' })
    expect(db.__calls.insert).toHaveLength(0)
  })

  it('存在しない生徒は insert せずエラーを返す', async () => {
    adminOk()
    const db = createMockDb({ maybeSingle: { data: null, error: null }, thenable: { error: null } })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: CHANNEL_ID, personId: PERSON_ID }),
    )
    expect(r).toEqual({ ok: false, error: '指定された生徒が見つかりません' })
    expect(db.__calls.insert).toHaveLength(0)
  })

  it('チャンネル重複は専用メッセージ（AC-15-03）', async () => {
    adminOk()
    vi.mocked(createServerClient).mockReturnValue(
      createMockDb({
        maybeSingle: { data: { name: '太郎' }, error: null },
        thenable: { error: { code: '23505' } },
      }),
    )
    const r = await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: CHANNEL_ID, personId: PERSON_ID }),
    )
    expect(r).toEqual({ ok: false, error: 'このチャンネルはすでに紐付けされています' })
  })

  it('チャンネルIDの形式が不正なら DB に触らず fieldErrors を返す（H-7 / H-8）', async () => {
    adminOk()
    const r = await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: 'not-a-channel', personId: PERSON_ID }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('入力内容を確認してください')
      expect(r.fieldErrors?.slackChannelId).toContain('チャンネルID')
    }
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('既定レポート未指定（none）は default_report_id = null で保存（H-11）', async () => {
    adminOk()
    const db = createMockDb({
      maybeSingle: { data: { name: '太郎' }, error: null },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await createBindingAction(
      undefined,
      fd({
        slackTeamId: TEAM_ID,
        slackChannelId: CHANNEL_ID,
        personId: PERSON_ID,
        defaultReportId: 'none',
      }),
    )
    expect(r).toEqual({ ok: true })
    expect(db.__calls.insert[0]).toMatchObject({ default_report_id: null })
  })

  it('既定レポートは当該生徒のものなら保存する（H-11）', async () => {
    adminOk()
    const db = createMockDb({
      maybeSingle: [
        { data: { name: '太郎' }, error: null },
        { data: { person_id: PERSON_ID }, error: null },
      ],
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await createBindingAction(
      undefined,
      fd({
        slackTeamId: TEAM_ID,
        slackChannelId: CHANNEL_ID,
        personId: PERSON_ID,
        defaultReportId: REPORT_ID,
      }),
    )
    expect(r).toEqual({ ok: true })
    expect(db.__calls.insert[0]).toMatchObject({ default_report_id: REPORT_ID })
  })

  it('他生徒のレポートは既定レポートにできない（別生徒のレポート混入防止）', async () => {
    adminOk()
    const db = createMockDb({
      maybeSingle: [
        { data: { name: '太郎' }, error: null },
        { data: { person_id: OTHER_PERSON_ID }, error: null },
      ],
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await createBindingAction(
      undefined,
      fd({
        slackTeamId: TEAM_ID,
        slackChannelId: CHANNEL_ID,
        personId: PERSON_ID,
        defaultReportId: REPORT_ID,
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fieldErrors?.defaultReportId).toBe('この生徒のレポートを選択してください')
    expect(db.__calls.insert).toHaveLength(0)
  })
})

describe('updateBindingAction', () => {
  it('staff（admin 以外）は forbidden で拒否される（EP-09 は admin 専用）', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('forbidden'))
    const r = await updateBindingAction(undefined, fd({ id: BINDING_ID, status: 'inactive' }))
    expect(r).toEqual({ ok: false, error: 'この操作は管理者のみ実行できます' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('正常時は name/status のみ更新（channel_id は不変, BR-15-01）', async () => {
    adminOk()
    const db = createMockDb({ thenable: { error: null } })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await updateBindingAction(
      undefined,
      fd({ id: BINDING_ID, slackChannelName: 'study-taro', status: 'inactive' }),
    )
    expect(r).toEqual({ ok: true })
    const updated = db.__calls.update[0] as Record<string, unknown>
    expect(updated).toMatchObject({ slack_channel_name: 'study-taro', status: 'inactive' })
    expect(updated).not.toHaveProperty('slack_channel_id')
  })

  it('一覧と詳細の両方を revalidate する（H-12）', async () => {
    adminOk()
    vi.mocked(createServerClient).mockReturnValue(createMockDb({ thenable: { error: null } }))
    await updateBindingAction(
      undefined,
      fd({ id: BINDING_ID, slackChannelName: 'study-taro', status: 'active' }),
    )
    expect(vi.mocked(revalidatePath).mock.calls.map(([p]) => p)).toEqual([
      '/admin/channels',
      `/admin/channels/${BINDING_ID}`,
    ])
  })
})
