/** @file
 * 検証: チャンネル紐付け Server Action の認可（staff 可）・重複検知・更新・再検証パス、
 *   および作成・変更の操作ログ（誰がどのチャンネルをどの生徒に紐付けたか）
 * @verifies AC-15-01, AC-15-02, AC-15-03, EP-07〜09（staff 可）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'

vi.mock('@shared/lib/auth/requireStaff', () => ({ requireStaff: vi.fn() }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createBindingAction, updateBindingAction } from './bindingActions'
import { BINDING_CREATED_CODE, BINDING_UPDATED_CODE } from '../lib/auditLog'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { NO_STAFF_ROLE_MESSAGE } from '@shared/lib/auth/authFailure'
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

const STAFF_EMAIL = 'staff@example.com'

/** 既定は staff（admin でなくても紐付けできることが EP-07〜09 の要件） */
const staffOk = () =>
  vi.mocked(requireStaff).mockResolvedValue({ userId: 'u1', email: STAFF_EMAIL, role: 'staff' })

/** 操作ログの行。logError は主処理の後に積むので常に最後の insert */
function auditRow(db: ReturnType<typeof createMockDb>): Record<string, unknown> | undefined {
  if (!db.__calls.from.includes('ai_error_logs')) return undefined
  return db.__calls.insert.at(-1) as Record<string, unknown>
}

beforeEach(() => vi.clearAllMocks())

describe('createBindingAction', () => {
  it('未認証はログイン要求（throw しない）', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('unauthorized'))
    const r = await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: CHANNEL_ID, personId: PERSON_ID }),
    )
    expect(r).toEqual({ ok: false, error: 'ログインが必要です' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('ロール未設定（forbidden）は拒否される。staff/admin だけが紐付けできる', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('forbidden'))
    const r = await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: CHANNEL_ID, personId: PERSON_ID }),
    )
    expect(r).toEqual({ ok: false, error: NO_STAFF_ROLE_MESSAGE })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('staff は紐付けを作成できる（EP-08 を staff に開放。運用: 紐付けは各スタッフが行う）', async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      userId: 'u1',
      email: STAFF_EMAIL,
      role: 'staff',
    })
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
    })
  })

  it('正常時は生徒名スナップショット付きで insert', async () => {
    staffOk()
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
    staffOk()
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
    staffOk()
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
    staffOk()
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
    staffOk()
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
    staffOk()
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
    staffOk()
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
    staffOk()
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
  it('ロール未設定（forbidden）は拒否される', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('forbidden'))
    const r = await updateBindingAction(undefined, fd({ id: BINDING_ID, status: 'inactive' }))
    expect(r).toEqual({ ok: false, error: NO_STAFF_ROLE_MESSAGE })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('staff は紐付けを更新できる（EP-09 を staff に開放）', async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      userId: 'u1',
      email: STAFF_EMAIL,
      role: 'staff',
    })
    const db = createMockDb({ thenable: { error: null } })
    vi.mocked(createServerClient).mockReturnValue(db)
    const r = await updateBindingAction(
      undefined,
      fd({ id: BINDING_ID, slackChannelName: 'study-taro', status: 'inactive' }),
    )
    expect(r).toEqual({ ok: true })
    expect(db.__calls.update).toHaveLength(1)
  })

  it('正常時は name/status のみ更新（channel_id は不変, BR-15-01）', async () => {
    staffOk()
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
    staffOk()
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

/**
 * 紐付けを誤ると別生徒として AI が回答するため、admin 限定を外した代わりに
 * 「誰がいつどのチャンネルをどの生徒に紐付けたか」を必ず残す（severity=info の操作ログ）。
 */
describe('操作ログ（CHANNEL_BINDING_CREATED / UPDATED）', () => {
  it('作成時に操作者・channel_id・person_id を記録する', async () => {
    staffOk()
    const db = createMockDb({
      maybeSingle: { data: { name: '山田太郎' }, error: null },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)

    await createBindingAction(
      undefined,
      fd({
        slackTeamId: TEAM_ID,
        slackChannelId: CHANNEL_ID,
        slackChannelName: 'study-taro',
        personId: PERSON_ID,
      }),
    )

    const row = auditRow(db)
    expect(row).toMatchObject({
      error_code: BINDING_CREATED_CODE,
      severity: 'info',
      slack_channel_id: CHANNEL_ID,
      person_id: PERSON_ID,
    })
    const message = String(row?.internal_message)
    expect(message).toContain(`actor=${STAFF_EMAIL}`)
    expect(message).toContain(`channel_id=${CHANNEL_ID}`)
    expect(message).toContain('channel_name=study-taro')
    expect(message).toContain(`person_id=${PERSON_ID}`)
    expect(message).toContain('person_name=山田太郎')
    expect(message).toContain('status=active')
  })

  it('操作ログは毎回積む（dedupeWhileUnresolved を使わない = 未解決判定の select をしない）', async () => {
    staffOk()
    const db = createMockDb({
      maybeSingle: { data: { name: '太郎' }, error: null },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)

    await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: CHANNEL_ID, personId: PERSON_ID }),
    )

    // ai_error_logs に触るのは insert の 1 回だけ（重複判定の読み取りが挟まらない）
    expect(db.__calls.from.filter((t) => t === 'ai_error_logs')).toEqual(['ai_error_logs'])
  })

  it('作成が失敗したときは操作ログを残さない（保存されていない紐付けを記録しない）', async () => {
    staffOk()
    const db = createMockDb({
      maybeSingle: { data: { name: '太郎' }, error: null },
      thenable: { error: { code: '23505' } },
    })
    vi.mocked(createServerClient).mockReturnValue(db)

    await createBindingAction(
      undefined,
      fd({ slackTeamId: TEAM_ID, slackChannelId: CHANNEL_ID, personId: PERSON_ID }),
    )

    expect(db.__calls.from).not.toContain('ai_error_logs')
  })

  it('更新時は変更前後の person_id と status を記録する', async () => {
    staffOk()
    const db = createMockDb({
      maybeSingle: {
        data: { slack_channel_id: CHANNEL_ID, person_id: PERSON_ID, status: 'active' },
        error: null,
      },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)

    await updateBindingAction(
      undefined,
      fd({ id: BINDING_ID, slackChannelName: 'study-taro', status: 'inactive' }),
    )

    const row = auditRow(db)
    expect(row).toMatchObject({
      error_code: BINDING_UPDATED_CODE,
      severity: 'info',
      slack_channel_id: CHANNEL_ID,
      person_id: PERSON_ID,
    })
    const message = String(row?.internal_message)
    expect(message).toContain(`actor=${STAFF_EMAIL}`)
    expect(message).toContain(`binding_id=${BINDING_ID}`)
    // person_id は UI から変えられない（BR-15-01）。付け替わっていないことが後から検証できる
    expect(message).toContain(`person_id_before=${PERSON_ID}`)
    expect(message).toContain(`person_id_after=${PERSON_ID}`)
    expect(message).toContain('status_before=active')
    expect(message).toContain('status_after=inactive')
  })

  it('更新が失敗したときは操作ログを残さない', async () => {
    staffOk()
    const db = createMockDb({
      maybeSingle: {
        data: { slack_channel_id: CHANNEL_ID, person_id: PERSON_ID, status: 'active' },
        error: null,
      },
      thenable: { error: { message: 'boom' } },
    })
    vi.mocked(createServerClient).mockReturnValue(db)

    const r = await updateBindingAction(undefined, fd({ id: BINDING_ID, status: 'inactive' }))

    expect(r).toEqual({ ok: false, error: '保存に失敗しました' })
    expect(db.__calls.from).not.toContain('ai_error_logs')
  })

  it('変更前が読めなくても更新と操作者の記録は続ける（操作者が消える方が困る）', async () => {
    staffOk()
    const db = createMockDb({
      maybeSingle: { data: null, error: { message: 'connection reset' } },
      thenable: { error: null },
    })
    vi.mocked(createServerClient).mockReturnValue(db)

    const r = await updateBindingAction(undefined, fd({ id: BINDING_ID, status: 'active' }))

    expect(r).toEqual({ ok: true })
    const row = auditRow(db)
    expect(row).toMatchObject({ error_code: BINDING_UPDATED_CODE, slack_channel_id: null })
    expect(String(row?.internal_message)).toContain(`actor=${STAFF_EMAIL}`)
  })
})
