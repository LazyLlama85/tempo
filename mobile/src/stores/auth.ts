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
      const res = session ? await fetchProfile(session.user.id) : { ok: true, profile: null }
      // A fetch failure (offline cold start) falls back to the cached profile so an
      // onboarded user is never bounced back into onboarding by a network blip.
      const profile = res.ok ? res.profile : readCachedProfile(session?.user.id)
      set({ session, profile, loading: false })
      if (res.ok && session) writeCachedProfile(session.user.id, res.profile)
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
      if (!session) {
        set({ session: null, profile: null })
        return
      }
      // Token refreshes fire on every app foreground (AppState-driven autoRefresh) —
      // the profile we hold is still the profile; don't re-fetch it each resume.
      if (event === 'TOKEN_REFRESHED' && get().profile) {
        set({ session })
        return
      }
      const res = await fetchProfile(session.user.id)
      // On a transient failure keep whatever profile we already had — nulling it
      // would flip the app back into onboarding mid-session.
      const profile = res.ok ? res.profile : (get().profile ?? readCachedProfile(session.user.id))
      set({ session, profile })
      if (res.ok) writeCachedProfile(session.user.id, res.profile)
      // Also run on fresh sign-in (getSession handles the returning-user case above)
      if (event === 'SIGNED_IN') {
        identifyUser(session.user.id)
        setCrashUser(session.user.id)
        // A brand-new account has no profile row yet — treat that as a signup.
        // Only a CONFIRMED missing row counts: a failed fetch (res.ok false) says
        // nothing about the account's age, and a returning user on a fresh install
        // has no cached profile to fall back on — default those to 'login'.
        track(res.ok && !res.profile ? 'user_signup' : 'login', {
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
    const userId = get().session?.user.id
    if (userId) writeCachedProfile(userId, null)
    await supabase.auth.signOut()
    resetUser()
    setCrashUser(null)
    set({ session: null, profile: null })
  },

  refreshProfile: async () => {
    const { session } = get()
    if (!session) return
    const res = await fetchProfile(session.user.id)
    if (!res.ok) return // keep the current profile — stale beats vanished
    set({ profile: res.profile })
    writeCachedProfile(session.user.id, res.profile)
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

// Distinguish "no row yet" (a real answer — new user) from "couldn't ask" (network/
// auth failure). Callers must never treat the latter as "profile gone".
async function fetchProfile(userId: string): Promise<{ ok: boolean; profile: UserProfile | null }> {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) return { ok: false, profile: null }
    return { ok: true, profile: (data as UserProfile) ?? null }
  } catch {
    return { ok: false, profile: null }
  }
}

// Last-known-good profile per user, in the SQLite-backed localStorage — lets an
// offline cold start render the app (tabs gate needs onboarding_complete) instead
// of stranding an onboarded user at the first onboarding screen.
const profileCacheKey = (userId: string) => `tempo.profile.${userId}`

function readCachedProfile(userId: string | undefined): UserProfile | null {
  if (!userId) return null
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(profileCacheKey(userId))
    return raw ? (JSON.parse(raw) as UserProfile) : null
  } catch {
    return null
  }
}

function writeCachedProfile(userId: string, profile: UserProfile | null): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (!ls) return
    if (profile) ls.setItem(profileCacheKey(userId), JSON.stringify(profile))
    else ls.removeItem(profileCacheKey(userId))
  } catch { /* cache is best-effort */ }
}
