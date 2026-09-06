// Routed through our own `exercise-media` edge function rather than calling
// RapidAPI directly, so the billable RapidAPI key lives on the server instead of
// being inlined into every shipped bundle (and, until 2026-09-06, sitting in a
// public repo). See supabase/functions/exercise-media.
//
// Both paths here are FALLBACKS: images normally come from our own
// `exercise-gifs` Storage bucket (see data/exerciseMedia.ts) and every caller
// already degrades to a placeholder, so a miss here is never a broken screen.
const MEDIA_FN = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/exercise-media`
const MEDIA_AUTH = {
  Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''}`,
}
const MEDIA_CONFIGURED = !!process.env.EXPO_PUBLIC_SUPABASE_URL

// Map our exercise names (lowercase) → ExerciseDB search terms.
// null means ExerciseDB doesn't have it; we fall back to the raw name which will
// likely return no result and show the barbell placeholder gracefully.
const SEARCH_OVERRIDE: Record<string, string> = {
  // Name clarifications
  'barbell back squat':          'barbell squat',
  'barbell overhead press':      'overhead press',
  'barbell bent-over row':       'barbell bent over row',
  'conventional deadlift':       'deadlift',
  'dumbbell row':                'dumbbell bent over row',
  'bicep curl':                  'dumbbell bicep curl',
  'tricep overhead extension':   'dumbbell overhead tricep extension',
  'cable fly':                   'cable crossover',
  'cable bicep curl':            'cable curl',
  'close-grip bench press':      'barbell close grip bench press',
  'front squat':                 'barbell front squat',
  'ab wheel rollout':            'wheel',
  'lat pulldown':                'cable lat pulldown',
  // Exercises not in ExerciseDB → substitute a visually similar one
  'pendlay row':                 'barbell bent over row',
  'pause squat':                 'barbell squat',
  'hollow body hold':            'plank',
  'weighted pull-up':            'pull up',
  'power clean':                 'barbell power clean',
  'rowing machine':              'seated cable row',
}

const idCache = new Map<string, string | null>()

export async function fetchExerciseId(name: string): Promise<string | null> {
  const key = name.toLowerCase()
  if (idCache.has(key)) return idCache.get(key) ?? null
  if (!MEDIA_CONFIGURED) return null

  const searchTerm = SEARCH_OVERRIDE[key] ?? key

  try {
    const res = await fetch(
      `${MEDIA_FN}?kind=search&name=${encodeURIComponent(searchTerm)}`,
      { headers: MEDIA_AUTH },
    )
    if (!res.ok) { idCache.set(key, null); return null }
    const raw = await res.json()
    // The function already resolves the first match to an id; the array shapes
    // it used to have to disambiguate are handled server-side now.
    const id: string | null = raw?.id ?? null
    idCache.set(key, id)
    return id
  } catch {
    idCache.set(key, null)
    return null
  }
}

export function gifSource(exerciseId: string) {
  return {
    uri: `${MEDIA_FN}?kind=image&id=${encodeURIComponent(exerciseId)}&resolution=180`,
    headers: MEDIA_AUTH,
    cacheKey: `ex_${exerciseId}`,
  }
}
