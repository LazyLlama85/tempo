import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile } from '@/types'
import { checkMissedWorkouts } from '@/lib/missedWorkouts'
import { refreshAdaptation } from '@/lib/adaptation'
import { identifyUser, resetUser, track } from '@/lib/analytics'
import { setCrashUser } from '@/lib/crashReporting'
import { registerPushToken, unregisterPushToken } from '@/lib/pushTokens'

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
      // Tie analytics + crash reports to the returning user.
      if (session) {
        identifyUser(session.user.id)
        setCrashUser(session.user.id)
        // Register this device for server-driven retention pushes.
        registerPushToken(supabase, session.user.id).catch(() => {})
        // Mark past-due workouts missed, then let those misses feed the mesocycle
        // (enough missed sessions shifts the coming weeks into recovery/deload).
        checkMissedWorkouts(supabase, session.user.id)
          .then(() => refreshAdaptation(supabase, session.user.id))
          .catch(() => {})
      }
    })

    supabase.auth.onAuthStateChange(async (event, session) => {
      const profile = session ? await fetchProfile(session.user.id) : null
      set({ session, profile })
      // Also run on fresh sign-in (getSession handles the returning-user case above)
      if (event === 'SIGNED_IN' && session) {
        identifyUser(session.user.id)
        setCrashUser(session.user.id)
        // A brand-new account has no profile row yet — treat that as a signup,
        // otherwise it's a returning login.
        track(profile ? 'login' : 'user_signup', {
          method: methodFromSession(session),
        })
        registerPushToken(supabase, session.user.id).catch(() => {})
        checkMissedWorkouts(supabase, session.user.id)
          .then(() => refreshAdaptation(supabase, session.user.id))
          .catch(() => {})
      }
    })
  },

  signOut: async () => {
    // Drop this device's push token first (while we're still authenticated, so
    // RLS lets us delete it) — a signed-out user shouldn't get retention pushes.
    await unregisterPushToken(supabase).catch(() => {})
    await supabase.auth.signOut()
    resetUser()
    setCrashUser(null)
    set({ session: null, profile: null })
  },

  refreshProfile: async () => {
    const { session } = get()
    if (!session) return
    const profile = await fetchProfile(session.user.id)
    set({ profile })
  },
}))

// Best-effort mapping of the Supabase session to the sign-in method used, for
// analytics. Anonymous (guest) sessions have no provider/email.
function methodFromSession(session: Session): 'google' | 'apple' | 'guest' {
  const provider = session.user.app_metadata?.provider
  if (provider === 'apple') return 'apple'
  if (provider === 'google') return 'google'
  return 'guest'
}

async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()
  return data ?? null
}
