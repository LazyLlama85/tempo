import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile } from '@/types'
import { identifyUser, resetUser, track } from '@/lib/analytics'
import { setCrashUser } from '@/lib/crashReporting'
import { registerPushToken, unregisterPushToken } from '@/lib/pushTokens'
import { syncSocialOnOpen } from '@/lib/social'

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
    // Cold-start safety net: (tabs)/_layout.tsx and onboarding/_layout.tsx both
    // render a blank screen for as long as `loading` is true, and this promise
    // chain was the only thing that ever flipped it — no `.catch`, no timeout.
    // On a genuinely fresh install this can race with other first-ever SQLite-
    // backed localStorage opens (the react-query persister, the profile cache)
    // the same way the theme/entitlements/units stores used to (see the
    // blank-screen-on-first-launch fixes in _layout.tsx) and never settle,
    // wedging the app blank until force-quit gives it a fresh process. Force
    // the gate open after the timeout below if the real result hasn't landed
    // yet; a late resolution still applies normally.
    //
    // Fixed 2026-08-12, founder-reported: on a slow connection, getSession()'s
    // token-refresh round trip can genuinely take longer than the old flat 5s —
    // the timeout fired first with `session` still null, (tabs)/_layout.tsx
    // redirected to /sign-in, and moments later the real result landed and
    // bounced the user straight back to Home. A dead-simple "5s always" can't
    // tell "nobody's signed in" apart from "someone IS signed in, the network
    // is just slow" — but this device already knows which one it is: `hadSession`
    // mirrors the profile cache below (same localStorage, no new mechanism) and
    // is true only after a REAL session has resolved here at least once. A
    // brand-new / genuinely signed-out device has nothing to wait for, so it
    // keeps the fast 5s timeout unchanged; a device with a real session to
    // recover gets a longer runway before the safety net gives up, which is
    // what actually avoids the flash-to-sign-in-then-bounce-back cycle.
    const timeoutMs = readHadSession() ? 20_000 : 5_000
    const timeout = setTimeout(() => {
      if (get().loading) set({ loading: false })
    }, timeoutMs)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const res = session ? await fetchProfile(session.user.id) : { ok: true, profile: null }
      // A fetch failure (offline cold start) falls back to the cached profile so an
      // onboarded user is never bounced back into onboarding by a network blip.
      const profile = res.ok ? res.profile : readCachedProfile(session?.user.id)
      clearTimeout(timeout)
      set({ session, profile, loading: false })
      writeHadSession(!!session)
      if (res.ok && session) writeCachedProfile(session.user.id, res.profile)
      // Tie analytics + crash reports to the returning user.
      if (session) {
        identifyUser(session.user.id)
        setCrashUser(session.user.id)
        // Register this device for server-driven retention pushes.
        registerPushToken(supabase, session.user.id).catch(() => {})
        // Social: award competitive badges for the closed week/month + publish streak milestones.
        syncSocialOnOpen(supabase, session.user.id, profile?.days_per_week).catch(() => {})
        // Missed-workout + adaptation used to also run here, racing Home's own
        // app-open sweep with no ordering guarantee between the two — the exact
        // mechanism behind a plan-cliff bug (MASTER_FIX_PLAN.md F1/F5). Home's
        // sweep ((tabs)/index.tsx) now owns both, in the order that matters.
      }
    }).catch(() => {
      clearTimeout(timeout)
      set({ loading: false })
    })

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (!session) {
        writeHadSession(false)
        set({ session: null, profile: null })
        return
      }
      // Token refreshes fire on every app foreground (AppState-driven autoRefresh) —
      // the profile we hold is still the profile; don't re-fetch it each resume.
      if (event === 'TOKEN_REFRESHED' && get().profile) {
        set({ session })
        return
      }
      // Narrowed alias — TS doesn't carry the `!session` narrowing above into the
      // nested `finishSignIn` closure below.
      const activeSession = session

      // fetchProfile is a plain network call with no built-in timeout, and it used
      // to gate `session` itself here — a slow/hanging fetch right at the moment of
      // peak network contention (an OAuth token exchange, then immediately this)
      // left the store's `session` null indefinitely, so sign-in.tsx's `if (session)
      // redirect` never fired: the screen just sat there looking dead (spinner
      // already cleared by sign-in.tsx's own `finally`) until a force-quit ran
      // initialize()'s already-timeout-guarded path fresh on a clean process.
      // Reported 2026-08-09 (Android, Google sign-in) — same bug class as N8's
      // slow-open finding, different call site. Same fix as initialize(): bound the
      // wait so `session` can't be held hostage, but don't abort the real fetch —
      // apply it when it lands even if the timeout already moved on.
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        finishSignIn(get().profile ?? readCachedProfile(activeSession.user.id), false)
      }, 5000)

      const res = await fetchProfile(activeSession.user.id)
      clearTimeout(timeout)
      if (settled) {
        if (res.ok) { set({ profile: res.profile }); writeCachedProfile(activeSession.user.id, res.profile) }
        return
      }
      settled = true
      // On a transient failure keep whatever profile we already had — nulling it
      // would flip the app back into onboarding mid-session.
      finishSignIn(res.ok ? res.profile : (get().profile ?? readCachedProfile(activeSession.user.id)), res.ok)

      function finishSignIn(profile: UserProfile | null, fetchOk: boolean) {
        set({ session: activeSession, profile })
        writeHadSession(true)
        if (fetchOk) writeCachedProfile(activeSession.user.id, profile)
        // Also run on fresh sign-in (getSession handles the returning-user case above)
        if (event === 'SIGNED_IN') {
          identifyUser(activeSession.user.id)
          setCrashUser(activeSession.user.id)
          // A brand-new account has no profile row yet — treat that as a signup.
          // Only a CONFIRMED missing row counts: an unresolved/failed fetch says
          // nothing about the account's age, and a returning user on a fresh install
          // has no cached profile to fall back on — default those to 'login'.
          track(fetchOk && !profile ? 'user_signup' : 'login', {
            method: methodFromSession(activeSession),
          })
          registerPushToken(supabase, activeSession.user.id).catch(() => {})
          syncSocialOnOpen(supabase, activeSession.user.id, profile?.days_per_week).catch(() => {})
          // Missed-workout + adaptation: see the comment in the getSession() path
          // above — both now run once, from Home's own app-open sweep.
        }
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
    writeHadSession(false)
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

// Device-local, no-userId-needed signal: "has a real session resolved on this
// device before?" Not tied to any one account (unlike the profile cache above)
// since it's read BEFORE we know who, if anyone, is signed in — its only job is
// telling initialize()'s cold-start timeout whether there's a session worth
// waiting longer for, or nothing to wait for at all.
const HAD_SESSION_KEY = 'tempo.hadSession'

function readHadSession(): boolean {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage?.getItem(HAD_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function writeHadSession(had: boolean): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (!ls) return
    if (had) ls.setItem(HAD_SESSION_KEY, '1')
    else ls.removeItem(HAD_SESSION_KEY)
  } catch { /* best-effort */ }
}
