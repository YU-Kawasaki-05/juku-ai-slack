// テスト用の環境変数を注入（env.ts の検証を通すため。実際の値は使わない）
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.SLACK_BOT_TOKEN ||= 'xoxb-test-token'
process.env.SLACK_SIGNING_SECRET ||= 'test-signing-secret'
process.env.SLACK_BOT_USER_ID ||= 'U_BOT'
process.env.ANTHROPIC_API_KEY ||= 'sk-ant-test'
process.env.RESEND_API_KEY ||= 're_test'
process.env.RESEND_FROM_EMAIL ||= 'noreply@test.com'

import '@testing-library/jest-dom'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
