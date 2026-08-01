import type { NextConfig } from 'next'

// Server Action の CSRF 保護（Origin/Host 一致検査）。本番では追加 origin を許可しない。
// 開発時のみ localhost を許可する（プロキシ経由や別ポートからのアクセス用）。
const isProduction = process.env.NODE_ENV === 'production'

const nextConfig: NextConfig = {
  ...(isProduction
    ? {}
    : {
        experimental: {
          serverActions: {
            allowedOrigins: ['localhost:3000', '127.0.0.1:3000'],
          },
        },
      }),
}

export default nextConfig
