import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'
import type { Database } from '@shared/types/database.types'

let client: ReturnType<typeof createSupabaseBrowserClient<Database>> | undefined

// Singleton — one instance per browser session.
export function getBrowserClient() {
  if (!client) {
    client = createSupabaseBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return client
}
