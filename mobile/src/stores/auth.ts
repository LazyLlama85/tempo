import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile } from '@/types'
import { checkMissedWorkouts } from '@/lib/missedWorkouts'

interface AuthState {
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  initialize: () => void
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  loading: true,

  initialize: () => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const profile = session ? await fetchProfile(session.user.id) : null
      set({ session, profile, loading: false })
      // Mark any past-due scheduled workouts as missed on app startup
      if (session) {
        checkMissedWorkouts(supabase, session.user.id).catch(() => {})
      }
    })

    supabase.auth.onAuthStateChange(async (event, session) => {
      const profile = session ? await fetchProfile(session.user.id) : null
      set({ session, profile })
      // Also run on fresh sign-in (getSession handles the returning-user case above)
      if (event === 'SIGNED_IN' && session) {
        checkMissedWorkouts(supabase, session.user.id).catch(() => {})
      }
    })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, profile: null })
  },

  refreshProfile: async () => {
    const { session } = get()
    if (!session) return
    const profile = await fetchProfile(session.user.id)
    set({ profile })
  },
}))

async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()
  return data ?? null
}
