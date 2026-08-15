import { createClient } from '@supabase/supabase-js'
import { fetchWithRetry } from '@/lib/fetchWithRetry'

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  {
    auth: {
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    // Same transient-failure tolerance as the native client — see
    // lib/fetchWithRetry.ts.
    global: { fetch: fetchWithRetry },
  }
)
