import 'react-native-url-polyfill/auto'
import 'expo-sqlite/localStorage/install'
import { AppState } from 'react-native'
import { createClient } from '@supabase/supabase-js'

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
