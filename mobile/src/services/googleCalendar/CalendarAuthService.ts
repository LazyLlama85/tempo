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
export async function connectGoogleCalendar(): Promise<ConnectResult> {
  const redirectUrl = makeRedirectUri({ scheme: 'tempo' })

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl,
      skipBrowserRedirect: true,
      scopes: SCOPE_STRING,
      // access_type=offline + prompt=consent are what make Google return a
      // *refresh* token (and re-issue one even if a grant already exists).
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })
  if (error || !data?.url) return { ok: false, error: error?.message ?? 'oauth_init_failed' }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl)
  console.log('[gcal-connect] browser result:', result.type)
  if (result.type !== 'success') return { ok: false, error: 'cancelled' }

  const parsed = new URL(result.url)

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
      console.log('[gcal-connect] exchange failed:', exErr?.message)
      return { ok: false, error: exErr?.message ?? 'exchange_failed' }
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
    } else if (!providerRefreshToken) {
      console.log('[gcal-connect] no code and no tokens in redirect:', result.url)
      return { ok: false, error: 'no_code' }
    }
  }

  console.log('[gcal-connect] hasRefreshToken:', !!providerRefreshToken, 'hasAccessToken:', !!providerToken)
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
