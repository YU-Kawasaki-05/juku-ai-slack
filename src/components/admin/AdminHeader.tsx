import { createAuthServerClient } from '@/shared/lib/supabase/authServerClient'
import AdminHeaderClient from './AdminHeaderClient'

export default async function AdminHeader() {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return <AdminHeaderClient email={user?.email ?? ''} />
}
