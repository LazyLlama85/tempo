const API_KEY = process.env.EXPO_PUBLIC_RAPIDAPI_KEY ?? ''
const API_HEADERS = {
  'X-RapidAPI-Key': API_KEY,
  'X-RapidAPI-Host': 'exercisedb.p.rapidapi.com',
}

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
  if (!API_KEY) return null

  const searchTerm = SEARCH_OVERRIDE[key] ?? key

  try {
    const encoded = encodeURIComponent(searchTerm)
    const res = await fetch(
      `https://exercisedb.p.rapidapi.com/exercises/name/${encoded}?limit=1&offset=0`,
      { headers: API_HEADERS }
    )
    if (!res.ok) { idCache.set(key, null); return null }
    const raw = await res.json()
    const list = Array.isArray(raw) ? raw : (raw?.exercises ?? raw?.data ?? [])
    const id: string | null = list[0]?.id ?? null
    idCache.set(key, id)
    return id
  } catch {
    idCache.set(key, null)
    return null
  }
}

export function gifSource(exerciseId: string) {
  return {
    uri: `https://exercisedb.p.rapidapi.com/image?exerciseId=${exerciseId}&resolution=180`,
    headers: API_HEADERS,
    cacheKey: `ex_${exerciseId}`,
  }
}
