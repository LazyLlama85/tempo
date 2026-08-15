import 'react-native-url-polyfill/auto'
import 'expo-sqlite/localStorage/install'
import { AppState } from 'react-native'
import { createClient } from '@supabase/supabase-js'
import { fetchWithRetry } from '@/lib/fetchWithRetry'

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  {
    auth: {
      storage: localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    // Survive a transient backend blip instead of turning it into a user-facing
    // error. A ~1-minute Supabase gateway outage (503s on every endpoint, with
    // Postgres itself healthy) is what got the app rejected by App Review under
    // Guideline 2.1(a) — onboarding's save failed and showed "Something went
    // wrong". See lib/fetchWithRetry.ts for exactly which failures are retried
    // and why writes are handled more conservatively than reads.
    global: { fetch: fetchWithRetry },
  }
)

// JS timers freeze while the app is backgrounded, so the auth token can expire
// there unnoticed — the first write after a long resume then fails with a JWT
// error ("Something went wrong" on saves that work on retry). Tying the refresh
// loop to the app lifecycle makes startAutoRefresh() run a refresh tick
// immediately on every foreground, closing that window.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})
supabase.auth.startAutoRefresh()
