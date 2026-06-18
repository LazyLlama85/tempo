// Tempo — Edge Function: google-calendar-token
//
// The server-side half of the Google Calendar integration (Architecture A).
// It owns everything that must NOT live in the app bundle: the Google client
// secret and the user's long-lived refresh token. Runs on Supabase Edge
// Runtime (Deno).
//
// Actions (POST JSON body { action, ... }), all scoped to the authenticated
// caller via their Supabase JWT:
//   • store      { refresh_token, scope } → persist the user's Google refresh
//                  token (captured once, right after they connect).
//   • token                              → exchange the stored refresh token for
//                  a fresh Google access token. Returns { access_token, expires_in }.
//   • status                             → { connected: boolean }.
//   • disconnect                         → delete the stored refresh token.
//
// Only `token` needs GOOGLE_CLIENT_ID/SECRET — store/status/disconnect must work
// without them, so connecting succeeds before the secrets are set.
//
// The refresh token is read/written with the SERVICE ROLE key, which bypasses
// the deny-all RLS on google_calendar_tokens — so the table is unreachable from
// the app, only from here.
//
// Deploy:  npx supabase functions deploy google-calendar-token
// Secrets: npx supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
//          (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
//           injected automatically by the platform.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Identify the caller from their Supabase JWT (forwarded by functions.invoke).
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.error('[gcal] missing Authorization header')
      return json({ error: 'missing_authorization' }, 401)
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) {
      console.error('[gcal] getUser failed:', userErr?.message ?? 'no user')
      return json({ error: 'invalid_session' }, 401)
    }

    // Service-role client for the locked-down token table (bypasses RLS).
    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    let body: { action?: string; refresh_token?: string; scope?: string }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }

    const action = body.action
    console.log(`[gcal] action=${action} user=${user.id}`)

    switch (action) {
      case 'store': {
        if (!body.refresh_token) return json({ error: 'refresh_token_required' }, 400)
        const { error } = await admin.from('google_calendar_tokens').upsert({
          user_id: user.id,
          refresh_token: body.refresh_token,
          scope: body.scope ?? null,
          updated_at: new Date().toISOString(),
        })
        if (error) {
          console.error('[gcal] store upsert failed:', error.message)
          return json({ error: `store_failed: ${error.message}` }, 500)
        }
        console.log('[gcal] stored refresh token for', user.id)
        return json({ ok: true })
      }

      case 'status': {
        const { data, error } = await admin
          .from('google_calendar_tokens')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle()
        if (error) {
          console.error('[gcal] status select failed:', error.message)
          return json({ error: `status_failed: ${error.message}` }, 500)
        }
        return json({ connected: !!data })
      }

      case 'disconnect': {
        const { error } = await admin.from('google_calendar_tokens').delete().eq('user_id', user.id)
        if (error) console.error('[gcal] disconnect failed:', error.message)
        return json({ ok: true })
      }

      case 'token': {
        const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
        const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
        if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
          console.error('[gcal] missing GOOGLE_CLIENT_ID/SECRET secrets')
          return json({ error: 'server_misconfigured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (supabase secrets set)' }, 500)
        }

        const { data: row, error: rowErr } = await admin
          .from('google_calendar_tokens')
          .select('refresh_token')
          .eq('user_id', user.id)
          .maybeSingle()
        if (rowErr) {
          console.error('[gcal] token lookup failed:', rowErr.message)
          return json({ error: `token_lookup_failed: ${rowErr.message}` }, 500)
        }
        if (!row?.refresh_token) return json({ error: 'not_connected' }, 404)

        const resp = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: row.refresh_token,
            grant_type: 'refresh_token',
          }),
        })
        const tok = await resp.json()

        if (!resp.ok) {
          console.error('[gcal] google token refresh failed:', JSON.stringify(tok))
          // Refresh token was revoked or expired (user removed access, etc.).
          if (tok.error === 'invalid_grant') {
            await admin.from('google_calendar_tokens').delete().eq('user_id', user.id)
            return json({ error: 'reconnect_required' }, 409)
          }
          return json({ error: tok.error ?? 'token_refresh_failed' }, 502)
        }

        return json({ access_token: tok.access_token, expires_in: tok.expires_in })
      }

      default:
        return json({ error: 'unknown_action' }, 400)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[gcal] unhandled error:', msg)
    return json({ error: `unhandled: ${msg}` }, 500)
  }
})
