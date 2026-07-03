import { createClient } from '@supabase/supabase-js'
import { env } from '../env'
import type { Database } from '@shared/types/database.types'

// Service Role client — server-side only. Never expose to the browser.
export function createServerClient() {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
