// Tempo — Edge Function: delete-account
//
// Permanently deletes the authenticated user's account and ALL their data. This is
// the server-side half of the in-app "Delete Account" flow that the App Store
// requires (Guideline 5.1.1(v): any app offering account creation must let users
// initiate account deletion from within the app).
//
// It deletes the auth.users row with the SERVICE ROLE key; every user-owned table
// references auth.users(id) ON DELETE CASCADE, so profiles, plans, scheduled
// workouts, logs, set logs, recovery check-ins, substitutions, adaptation events
// and the Google refresh-token row all go with it. Nothing is left behind.
//
// Scoped to the caller: a user can only ever delete THEMSELVES (the id comes from
// their verified JWT, never from the request body).
//
// Deploy:  npx supabase functions deploy delete-account
//          (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
//           injected automatically by the platform.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
    if (!authHeader) return json({ error: 'missing_authorization' }, 401)

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'invalid_session' }, 401)

    // Service-role client can delete the auth user; cascades wipe all owned rows.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id)
    if (delErr) {
      console.error('[delete-account] deleteUser failed:', delErr.message)
      return json({ error: `delete_failed: ${delErr.message}` }, 500)
    }

    console.log('[delete-account] deleted user', user.id)
    return json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[delete-account] unhandled error:', msg)
    return json({ error: `unhandled: ${msg}` }, 500)
  }
})
