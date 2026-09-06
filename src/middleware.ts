import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(
          cookiesToSet: Array<{ name: string; value: string; options: Record<string, unknown> }>,
        ) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2]),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && pathname.startsWith('/admin')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/admin', request.url))
  }

  return supabaseResponse
}

/**
 * 保護対象は「/admin 配下」と「/login」だけ。
 *
 * ⚠️ `/set-password` を**絶対に追加しないこと**。招待リンク（Supabase recovery）は
 * トークンを URL フラグメント（`#access_token=...`）で渡すため、matcher に入れると
 * 未認証のまま開いた瞬間に /login へリダイレクトされ、リダイレクトでフラグメントが
 * 消えて招待リンクが二度と使えなくなる（E2E: auth-guard.spec.ts が固定）。
 * このページ自体の安全性は「セッションが無ければパスワードを変更できない」
 * （Supabase の PUT /auth/v1/user が Bearer トークン必須）で担保している。
 */
export const config = {
  matcher: ['/admin/:path*', '/login'],
}
