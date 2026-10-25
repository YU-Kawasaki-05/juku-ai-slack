/** @file
 * 機能: レポート本文を Markdown ファイルとしてダウンロードする（GET /admin/reports/:id/markdown）
 * 入力: パスの report id（UUID）
 * 出力: body_markdown をそのまま .md で返す。未認証 401 / ロール無し 403 / 不正 ID・不在 404
 * 例外: DB エラーは 500
 * 依存: requireStaff, createServerClient, buildAttachmentFileName
 * 副作用: なし（読み取りのみ）
 * セキュリティ: staff 以上のみ。Route Handler は middleware の matcher を通らない経路もあり得るため、
 *   ここで必ず requireStaff を呼ぶ。ファイル名は表示名由来なのでサニタイズし、
 *   Content-Disposition には RFC 5987 の filename* で渡す（改行・引用符によるヘッダ注入を防ぐ）。
 *   nosniff + attachment で、本文中の HTML をブラウザが解釈しない
 * @implements FR-08, FR-13
 */
import { NextResponse } from 'next/server'
import { requireStaff } from '@shared/lib/auth/requireStaff'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { buildAttachmentFileName } from '@features/monthly-reports'
import { isUuid } from '../../../searchParams'

export const runtime = 'nodejs'

/** encodeURIComponent が残す ' ( ) * は filename* の属性値に使えないので % エンコードする */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function json(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireStaff()
  } catch (e) {
    return (e as Error)?.message === 'forbidden' ? json(403, 'forbidden') : json(401, 'unauthorized')
  }

  const { id } = await params
  if (!isUuid(id)) return json(404, 'not_found')

  const { data, error } = await createServerClient()
    .from('reports')
    .select('body_markdown, report_month, persons(name, display_name)')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[reports/markdown] query failed', error.message)
    return json(500, 'internal_error')
  }
  if (!data) return json(404, 'not_found')

  // persons は 1 対 1 の外部キー結合（配列で返る型定義になるため両方受ける）
  const person = Array.isArray(data.persons) ? data.persons[0] : data.persons
  const label = person?.display_name?.trim() || person?.name || '生徒'
  const month = data.report_month.slice(0, 7)
  const fileName = buildAttachmentFileName(month, label)

  return new NextResponse(data.body_markdown ?? '', {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // ASCII のフォールバック名と、UTF-8 の正式名を併記する
      'Content-Disposition': `attachment; filename="report-${month}.md"; filename*=UTF-8''${encodeRfc5987(fileName)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
