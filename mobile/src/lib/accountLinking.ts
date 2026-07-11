// Tempo — guest account linking (§1.1).
//
// A guest's anonymous Supabase session IS their account: a reinstall, a new phone,
// or clearing app data permanently orphans every logged workout. This converts a
// guest into a permanent Apple/Google account WITHOUT ever changing the user id —
// so all their history stays attached — by LINKING the new identity onto the
// existing anonymous user.
//
// CRITICAL: this must use linkIdentity(), never signInWithOAuth()/signInWithIdToken().
// Those create/sign into the provider's user and would SWAP the session, stranding
// all the guest's data on the old (now unreachable) anonymous user id. This mirrors
// the safe pattern CalendarAuthService already uses for guest calendar connects —
// same reason, same belt-and-braces "did the user id change?" guard.
//
// linkIdentity() requires "manual linking" enabled on the Supabase project
// (Auth → Providers). The guest calendar-connect flow already depends on it; when
// it's off we surface `link_unavailable` rather than destroying the session.

import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import { supabase } from '@/lib/supabase'

WebBrowser.maybeCompleteAuthSession()

/** Number of completed workouts after which the one-time save prompt may fire. */
export const GUEST_SAVE_PROMPT_AFTER = 3

export type LinkProvider = 'google' | 'apple'

export interface LinkResult {
  ok: boolean
  /** Machine-readable reason when ok === false. */
  error?:
    | 'not_signed_in'
    | 'already_permanent'
    | 'link_unavailable'
    | 'identity_taken'
    | 'session_switched'
    | 'exchange_failed'
    | 'cancelled'
    | 'oauth_failed'
}

// Attach an Apple/Google identity onto the current anonymous session. On success
// the same user (same id, same data) is no longer anonymous and now has an email.
export async function linkGuestAccount(provider: LinkProvider): Promise<LinkResult> {
  const redirectUrl = makeRedirectUri({ scheme: 'tempo' })

  const { data: { session: current } } = await supabase.auth.getSession()
  if (!current) return { ok: false, error: 'not_signed_in' }
  // Nothing to do for a real account — and linking onto a non-anonymous user isn't
  // this flow's job. Callers gate on is_anonymous, but guard here too.
  if (!current.user.is_anonymous) return { ok: false, error: 'already_permanent' }
  const originalUserId = current.user.id

  const options = { redirectTo: redirectUrl, skipBrowserRedirect: true }

  let authUrl: string
  try {
    const { data, error } = await supabase.auth.linkIdentity({ provider, options })
    // A disabled "manual linking" project setting surfaces here; treat any init
    // failure as link_unavailable so the UI can explain rather than error out.
    if (error || !data?.url) return { ok: false, error: 'link_unavailable' }
    authUrl = data.url
  } catch {
    return { ok: false, error: 'link_unavailable' }
  }

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl)
  if (result.type !== 'success') return { ok: false, error: 'cancelled' }

  const parsed = new URL(result.url)
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''))

  // Supabase reports link failures inside the redirect itself. The one real users
  // hit: this Apple/Google identity is ALREADY another Tempo account's login, so
  // linking would steal it — Supabase refuses. Surface it as its own reason.
  const errCode = parsed.searchParams.get('error_code') ?? hashParams.get('error_code')
  const errDesc = parsed.searchParams.get('error_description') ?? hashParams.get('error_description')
  if (errCode || errDesc) {
    if (errCode === 'identity_already_exists' || /already/i.test(errDesc ?? '')) {
      return { ok: false, error: 'identity_taken' }
    }
    return { ok: false, error: 'oauth_failed' }
  }

  // Complete the flow (PKCE code or implicit hash), then verify the session still
  // belongs to the SAME user — if OAuth somehow swapped it, bail loudly rather
  // than silently continuing as (and re-stranding data on) someone else.
  const code = parsed.searchParams.get('code')
  if (code) {
    const { data: sess, error: exErr } = await supabase.auth.exchangeCodeForSession(code)
    if (exErr || !sess.session) return { ok: false, error: 'exchange_failed' }
    if (sess.session.user.id !== originalUserId) return { ok: false, error: 'session_switched' }
  } else {
    const access_token = hashParams.get('access_token')
    const refresh_token = hashParams.get('refresh_token')
    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token })
      const { data: { session: after } } = await supabase.auth.getSession()
      if (after && after.user.id !== originalUserId) return { ok: false, error: 'session_switched' }
    }
    // No code and no tokens: linkIdentity can complete server-side; the refresh
    // below pulls the now-permanent identity into the local session.
  }

  // Pull a fresh JWT so is_anonymous flips to false locally (drives the guest-only
  // UI to disappear). Best-effort — the link itself already succeeded server-side.
  await supabase.auth.refreshSession().catch(() => {})
  return { ok: true }
}

// Canonical "completed workouts" count — the same measure the progression engine
// uses (completed scheduled sessions). Cheap head count. Used to gate the one-time
// post-workout save prompt to the point where there's real history worth losing.
export async function countCompletedWorkouts(userId: string): Promise<number> {
  const { count } = await supabase
    .from('scheduled_workouts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'completed')
  return count ?? 0
}

// ── One-time prompt gating (durable, per-user, device-local) ─────────────────────
// Force-close-proof like the tutorial flags: persisted to localStorage keyed by the
// guest's user id, so the modal fires at most once even across restarts, and never
// re-nags after they've dismissed it once. Keyed per user so a later, different
// guest session on the same device still gets its own single prompt.
const savePromptKey = (userId: string) => `tempo.guestSavePrompt.${userId}`

export function guestSavePromptSeen(userId: string): boolean {
  try {
    // Broken storage → treat as seen (never nag) rather than risk repeat prompts.
    return !!(globalThis as { localStorage?: Storage }).localStorage?.getItem(savePromptKey(userId))
  } catch {
    return true
  }
}

export function markGuestSavePromptSeen(userId: string): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(savePromptKey(userId), '1')
  } catch { /* best-effort; UX-only gating */ }
}
