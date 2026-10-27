/** @file
 * 検証: レポートの Markdown ダウンロード（staff 以上・不正 ID・不在・ヘッダ・ファイル名の安全性）
 * @verifies FR-08, FR-13
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from '@/test/mocks/supabaseMock'

vi.mock('@shared/lib/auth/requireStaff', () => ({ requireStaff: vi.fn() }))
vi.mock('@shared/lib/supabase/serverClient', () => ({ createServerClient: vi.fn() }))

import { GET } from './route'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { createServerClient } from '@shared/lib/supabase/serverClient'

const ID = '22222222-2222-4222-8222-222222222222'
const call = (id = ID) => GET(new Request(`http://localhost/admin/reports/${id}/markdown`), { params: Promise.resolve({ id }) })

const staffOk = () =>
  vi.mocked(requireStaff).mockResolvedValue({ userId: 'u1', email: 'a@b.com', role: 'staff' })

function dbWith(row: unknown, error: unknown = null) {
  const db = createMockDb({ maybeSingle: { data: row, error } })
  vi.mocked(createServerClient).mockReturnValue(db)
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /admin/reports/:id/markdown', () => {
  it('未認証は 401、ロール未設定は 403（DB に触れない）', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new Error('unauthorized'))
    expect((await call()).status).toBe(401)
    vi.mocked(requireStaff).mockRejectedValue(new Error('forbidden'))
    expect((await call()).status).toBe(403)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('UUID でない ID は 404（Postgres の 22P02 を踏まない）', async () => {
    staffOk()
    expect((await call('not-a-uuid')).status).toBe(404)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('存在しないレポートは 404、DB エラーは 500', async () => {
    staffOk()
    dbWith(null)
    expect((await call()).status).toBe(404)
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dbWith(null, { message: 'boom' })
    expect((await call()).status).toBe(500)
    err.mockRestore()
  })

  it('body_markdown をそのまま .md で返す（表示名があればファイル名に使う）', async () => {
    staffOk()
    dbWith({
      body_markdown: '## 見出し\n本文',
      report_month: '2026-09-01',
      persons: { name: '本名', display_name: '表示名' },
    })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('## 見出し\n本文')
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const cd = res.headers.get('content-disposition') ?? ''
    expect(cd).toContain('attachment')
    expect(cd).toContain('filename="report-2026-09.md"')
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent('2026-09_表示名.md')}`)
  })

  it('表示名が無ければ本名。結合が配列で返っても読める', async () => {
    staffOk()
    dbWith({ body_markdown: 'x', report_month: '2026-09-01', persons: [{ name: '本名', display_name: null }] })
    const cd = (await call()).headers.get('content-disposition') ?? ''
    expect(cd).toContain(encodeURIComponent('2026-09_本名.md'))
  })

  it('本文が空でも 200 で空ファイル', async () => {
    staffOk()
    dbWith({ body_markdown: null, report_month: '2026-09-01', persons: { name: 'a', display_name: null } })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('表示名に改行・引用符・括弧があってもヘッダを壊さない', async () => {
    staffOk()
    dbWith({
      body_markdown: 'x',
      report_month: '2026-09-01',
      persons: { name: 'x', display_name: 'a"b\r\nSet-Cookie: x=1\'(*)' },
    })
    const res = await call()
    const cd = res.headers.get('content-disposition') ?? ''
    expect(cd).not.toMatch(/[\r\n]/)
    // 注入しようとしたヘッダが実際には作られていない
    expect(res.headers.get('set-cookie')).toBeNull()
    // filename* の値に ' ( ) * " が生で残らない
    const star = cd.split("filename*=UTF-8''")[1]
    expect(star).not.toMatch(/['()*"]/)
  })
})
