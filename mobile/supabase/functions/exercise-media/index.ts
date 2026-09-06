// Arclo — Edge Function: exercise-media
//
// Proxies the three ExerciseDB (RapidAPI) endpoints the app still calls live, so
// the RapidAPI key lives on the server instead of inside every shipped bundle.
//
// WHY. `EXPO_PUBLIC_RAPIDAPI_KEY` is inlined into the app at build time, which
// means it ships inside every IPA and APK and can be read out of either. It was
// also committed to a PUBLIC GitHub repo. Unlike the other EXPO_PUBLIC_* values
// (Supabase publishable key, RevenueCat SDK key, PostHog project key, Sentry
// DSN) — which are all designed to be client-visible — a RapidAPI key is
// billable per request and is not. Anyone holding it can spend the quota, which
// has already happened once: see data/exerciseMedia.ts, where live image calls
// were moved to our own Storage bucket precisely because "every install hitting
// the same shared plan on every view" exhausted the monthly allowance.
//
// WHAT STILL CALLS RAPIDAPI. Images normally come from our `exercise-gifs`
// Storage bucket. These three are the remaining live paths, and all of them are
// FALLBACKS behind that bucket or behind curated media, so every caller already
// degrades gracefully to a placeholder if this returns nothing:
//   kind=search        name -> ExerciseDB id      (lib/exerciseGif.fetchExerciseId)
//   kind=instructions  id   -> instruction text   (lib/exerciseDb.fetchRemoteInstructions)
//   kind=image         id   -> the animated clip  (lib/exerciseGif.gifSource)
//
// AUTH. Deployed with JWT verification ON, so it is reachable with the app's
// Supabase key rather than being an open proxy anyone can point at the quota.
//
// Deploy: npx supabase functions deploy exercise-media
// Secret: npx supabase secrets set RAPIDAPI_KEY=...

const HOST = 'exercisedb.p.rapidapi.com'

function upstreamHeaders(): HeadersInit {
  return {
    'x-rapidapi-key': Deno.env.get('RAPIDAPI_KEY') ?? '',
    'x-rapidapi-host': HOST,
  }
}

/** Cache aggressively: this data never changes for a given exercise. */
const CACHE = 'public, max-age=86400, s-maxage=604800'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': CACHE },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return new Response('method_not_allowed', { status: 405 })
  if (!Deno.env.get('RAPIDAPI_KEY')) {
    console.error('[exercise-media] RAPIDAPI_KEY is not set')
    return json({ error: 'not_configured' }, 503)
  }

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const id = url.searchParams.get('id')
  const name = url.searchParams.get('name')

  try {
    if (kind === 'search') {
      if (!name) return json({ error: 'missing_name' }, 400)
      const r = await fetch(
        `https://${HOST}/exercises/name/${encodeURIComponent(name)}?limit=1&offset=0`,
        { headers: upstreamHeaders() },
      )
      if (!r.ok) return json({ id: null }, 200) // caller treats "no match" as a gap
      const raw = await r.json()
      const list = Array.isArray(raw) ? raw : (raw?.exercises ?? raw?.data ?? [])
      return json({ id: list[0]?.id ?? null })
    }

    if (kind === 'instructions') {
      if (!id) return json({ error: 'missing_id' }, 400)
      const r = await fetch(`https://${HOST}/exercises/exercise/${encodeURIComponent(id)}`, {
        headers: upstreamHeaders(),
      })
      if (!r.ok) return json({ instructions: [] }, 200)
      const raw = await r.json()
      const body = Array.isArray(raw) ? raw[0] : raw
      const instructions = Array.isArray(body?.instructions) ? body.instructions : []
      return json({ instructions })
    }

    if (kind === 'image') {
      if (!id) return json({ error: 'missing_id' }, 400)
      const resolution = url.searchParams.get('resolution') ?? '180'
      const r = await fetch(
        `https://${HOST}/image?exerciseId=${encodeURIComponent(id)}&resolution=${encodeURIComponent(resolution)}`,
        { headers: upstreamHeaders() },
      )
      // Pass the upstream failure through as a 404 so <Image onError> fires and
      // the caller shows its placeholder, exactly as it does for a missing clip.
      if (!r.ok) return new Response('not_found', { status: 404 })
      return new Response(r.body, {
        status: 200,
        headers: {
          'Content-Type': r.headers.get('content-type') ?? 'image/gif',
          'Cache-Control': CACHE,
        },
      })
    }

    return json({ error: 'unknown_kind' }, 400)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[exercise-media]', msg)
    // Never surface a hard failure to the UI — every caller has a placeholder.
    return json({ error: 'upstream_failed' }, 502)
  }
})
