// Tempo — CalendarAuthService (client half of the Google Calendar integration).
//
// Architecture A: we reuse the user's existing Supabase Google sign-in. There is
// NO second token store on the device — the long-lived refresh token goes
// straight to the `google-calendar-token` Edge Function (which persists it
// server-side, behind the client secret). The only thing we keep on the client
// is the short-lived Google *access* token, cached in memory and re-minted on
// demand. That's deliberately more secure than storing both tokens on-device:
// nothing sensitive is ever written to disk.
//
// Note: assumes the user is signed in with the same Google account. Converting
// an anonymous guest to a Google account should use linkIdentity() (future).

import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import { supabase } from '@/lib/supabase'
import { GOOGLE_CALENDAR_SCOPES, TOKEN_EDGE_FUNCTION } from './config'

WebBrowser.maybeCompleteAuthSession()

const SCOPE_STRING = GOOGLE_CALENDAR_SCOPES.join(' ')

// In-memory access-token cache (epoch-ms expiry). Lost on app restart → a single
// cheap getGoogleAccessToken() re-mint. Never persisted to disk by design.
let accessToken: string | null = null
let accessTokenExpiry = 0

export interface ConnectResult {
  ok: boolean
  /** machine-readable reason when ok === false (e.g. 'cancelled', 'no_refresh_token') */
  error?: string
}

// Pull the real message out of a Supabase Functions error. On a non-2xx response
// supabase-js wraps the Response on `.context`; our function returns { error },
// so surfacing it tells the user exactly what failed (missing table, secret, …).
async function fnErrorReason(err: unknown): Promise<string | null> {
  const ctx = (err as { context?: { json?: () => Promise<{ error?: string }> } })?.context
  try {
    const body = ctx?.json ? await ctx.json() : null
    if (body?.error) return String(body.error)
  } catch {
    /* body wasn't JSON / already consumed */
  }
  return (err as { message?: string })?.message ?? null
}

// 1) Connect — run Google OAuth (forcing re-consent) WITH the calendar.events
// scope, capture the one-time provider_refresh_token, and hand it to the Edge
// Function to store. Idempotent: re-running just refreshes the stored token.
//
// CRITICAL: this must never replace the signed-in Supabase user. signInWithOAuth
// creates/signs into the Google-identity user — for a guest or Apple-sign-in user
// that would swap the session and strand ALL their data on the old user id. So:
//   • Google-auth users re-consent via signInWithOAuth (same account → same user),
//     with a post-exchange identity check as a belt-and-braces guard.
//   • Everyone else gets the Google identity LINKED onto their existing account
//     via linkIdentity(). That needs "manual linking" enabled on the Supabase
//     project (Auth → Providers); when it isn't, we fail with a clear reason
//     instead of silently destroying the session.
export async function connectGoogleCalendar(): Promise<ConnectResult> {
  const redirectUrl = makeRedirectUri({ scheme: 'tempo' })

  const { data: { session: current } } = await supabase.auth.getSession()
  if (!current) return { ok: false, error: 'not_signed_in' }
  const originalUserId = current.user.id
  const isGoogleUser = current.user.app_metadata?.provider === 'google'

  const oauthOptions = {
    redirectTo: redirectUrl,
    skipBrowserRedirect: true,
    scopes: SCOPE_STRING,
    // access_type=offline + prompt=consent are what make Google return a
    // *refresh* token (and re-issue one even if a grant already exists).
    queryParams: { access_type: 'offline', prompt: 'consent' },
  }

  let authUrl: string
  if (isGoogleUser) {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: oauthOptions })
    if (error || !data?.url) return { ok: false, error: error?.message ?? 'oauth_init_failed' }
    authUrl = data.url
  } else {
    // Non-Google accounts (Apple / email / guest) attach Google via linkIdentity,
    // which requires "manual linking" enabled on the Supabase project. When it's
    // disabled Supabase returns "Manual linking is disabled" — surface the single
    // clean `link_unavailable` reason (→ "use the device calendar") rather than
    // leaking that raw backend string to the user as "connection failed".
    try {
      const { data, error } = await supabase.auth.linkIdentity({ provider: 'google', options: oauthOptions })
      if (error || !data?.url) return { ok: false, error: 'link_unavailable' }
      authUrl = data.url
    } catch {
      return { ok: false, error: 'link_unavailable' }
    }
  }

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl)
  if (result.type !== 'success') return { ok: false, error: 'cancelled' }

  const parsed = new URL(result.url)

  // Supabase reports link/OAuth failures inside the redirect itself (query or
  // hash) — the browser flow "succeeds" but carries an error payload. The one
  // real users hit: the Google identity is already ANOTHER Tempo account's
  // login (they signed in with Google once before, and are now on an Apple or
  // guest account). Linking would steal that account's login, so Supabase
  // refuses — surface it as its own reason with copy that explains the way out.
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''))
  const oauthErrCode = parsed.searchParams.get('error_code') ?? hashParams.get('error_code')
  const oauthErrDesc = parsed.searchParams.get('error_description') ?? hashParams.get('error_description')
  if (oauthErrCode || oauthErrDesc) {
    if (oauthErrCode === 'identity_already_exists' || /already linked/i.test(oauthErrDesc ?? '')) {
      return { ok: false, error: 'identity_taken' }
    }
    return { ok: false, error: oauthErrDesc ?? oauthErrCode ?? 'oauth_failed' }
  }

  // Supabase returns either the PKCE flow (?code=…) or the implicit flow
  // (#access_token=…&provider_refresh_token=…) depending on project config.
  // The sign-in screen handles both, so connect must too — only handling `code`
  // was the bug (it reported 'no_code' when the tokens came back in the hash).
  let providerRefreshToken: string | null | undefined
  let providerToken: string | null | undefined

  const code = parsed.searchParams.get('code')
  if (code) {
    const { data: sess, error: exErr } = await supabase.auth.exchangeCodeForSession(code)
    if (exErr || !sess.session) {
      return { ok: false, error: exErr?.message ?? 'exchange_failed' }
    }
    // Belt and braces: if OAuth somehow landed on a DIFFERENT user (e.g. a
    // Google-auth user picked another Google account in the chooser), say so
    // loudly instead of quietly carrying on as somebody else.
    if (sess.session.user.id !== originalUserId) {
      return { ok: false, error: 'session_switched' }
    }
    providerRefreshToken = sess.session.provider_refresh_token
    providerToken = sess.session.provider_token
  } else {
    // Implicit flow — the Google provider tokens arrive in the URL hash.
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''))
    const access_token = hash.get('access_token')
    const refresh_token = hash.get('refresh_token')
    providerRefreshToken = hash.get('provider_refresh_token')
    providerToken = hash.get('provider_token')
    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token })
      const { data: { session: after } } = await supabase.auth.getSession()
      if (after && after.user.id !== originalUserId) {
        return { ok: false, error: 'session_switched' }
      }
    } else if (!providerRefreshToken) {
      return { ok: false, error: 'no_code' }
    }
  }

  if (!providerRefreshToken) {
    // Consent succeeded but Google didn't return a refresh token — usually a
    // stale grant that skipped re-consent. Revoke access and retry.
    return { ok: false, error: 'no_refresh_token' }
  }

  const { error: storeErr } = await supabase.functions.invoke(TOKEN_EDGE_FUNCTION, {
    body: { action: 'store', refresh_token: providerRefreshToken, scope: SCOPE_STRING },
  })
  if (storeErr) {
    const reason = await fnErrorReason(storeErr)
    return { ok: false, error: reason ?? 'store_failed' }
  }

  // Cache the fresh access token we already hold (Google tokens last ~1h).
  if (providerToken) {
    accessToken = providerToken
    accessTokenExpiry = Date.now() + 55 * 60 * 1000
  }
  return { ok: true }
}

// 2) Get a valid Google access token — the function every Calendar API call uses.
// Returns the in-memory token if still fresh, else re-mints it via the Edge
// Function (which refreshes against Google server-side). Returns null if the
// user isn't connected or the refresh failed (UI should offer to reconnect).
export async function getGoogleAccessToken(): Promise<string | null> {
  if (accessToken && Date.now() < accessTokenExpiry - 60_000) return accessToken

  const { data, error } = await supabase.functions.invoke(TOKEN_EDGE_FUNCTION, {
    body: { action: 'token' },
  })
  if (error || !data?.access_token) {
    accessToken = null
    accessTokenExpiry = 0
    return null
  }
  accessToken = data.access_token
  accessTokenExpiry = Date.now() + (data.expires_in ?? 3600) * 1000
  return accessToken
}

// Force the next getGoogleAccessToken() to re-mint. Call this if Google rejects
// the cached token mid-request (HTTP 401) so the caller can transparently retry.
export function invalidateGoogleAccessToken(): void {
  accessToken = null
  accessTokenExpiry = 0
}

// 3) Has the user connected Google Calendar? Cheap existence check (no token mint).
export async function isGoogleCalendarConnected(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke(TOKEN_EDGE_FUNCTION, {
    body: { action: 'status' },
  })
  if (error) return false
  return !!data?.connected
}

// 4) Disconnect — clear the local cache and drop the server-side refresh token.
export async function disconnectGoogleCalendar(): Promise<void> {
  accessToken = null
  accessTokenExpiry = 0
  try {
    await supabase.functions.invoke(TOKEN_EDGE_FUNCTION, { body: { action: 'disconnect' } })
  } catch {
    // Best-effort — local cache is already cleared.
  }
}
