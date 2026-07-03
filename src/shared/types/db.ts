/** @file
 * 機能: Supabase 生成型から Row/Insert/Update を取り出すヘルパー型
 * 依存: database.types.ts
 * @implements -
 */
import type { Database } from './database.types'

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

/** Service Role Supabase クライアントの型（サーバー専用） */
export type ServerDb = import('@supabase/supabase-js').SupabaseClient<Database>
