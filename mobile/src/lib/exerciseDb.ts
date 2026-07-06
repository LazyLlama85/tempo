// Tempo — ExerciseDB integration for the imported library.
//
// Every exercise imported by scripts/build-exercise-library.mjs has a UUID that
// EMBEDS its ExerciseDB id: edb00000-0000-4000-8000-<id zero-padded to 12>.
// That one convention lets the app resolve a form GIF and full how-to steps for
// 1200+ movements with no lookup table shipped in the bundle. Hand-written rows
// use a reserved 9xxxxxxxxxxx suffix and never resolve here.
//
// Imported rows deliberately carry EMPTY instructions in the DB (keeps the seed
// small); the form guide fetches steps from the ExerciseDB detail endpoint on
// first open and caches them for the session.

const HOST = 'exercisedb.p.rapidapi.com'
const API_KEY = process.env.EXPO_PUBLIC_RAPIDAPI_KEY ?? ''
const HEADERS = { 'x-rapidapi-key': API_KEY, 'x-rapidapi-host': HOST }

const IMPORTED_PREFIX = 'edb00000-0000-4000-8000-'

// The ExerciseDB id embedded in an imported exercise's UUID, or null for
// original-seed, hand-written, and custom exercises.
export function exdbIdForExercise(exerciseId: string | null | undefined): string | null {
  if (!exerciseId || !exerciseId.startsWith(IMPORTED_PREFIX)) return null
  const suffix = exerciseId.slice(IMPORTED_PREFIX.length)
  if (!/^0{8}\d{4}$/.test(suffix)) return null // 9xxx… = hand-written, no remote source
  return suffix.slice(-4)
}

const instructionsCache = new Map<string, string[]>()

// Step-by-step instructions for an imported exercise, fetched from ExerciseDB.
// Returns [] when offline / no key / unknown id — callers fall back gracefully.
export async function fetchRemoteInstructions(exdbId: string): Promise<string[]> {
  const cached = instructionsCache.get(exdbId)
  if (cached) return cached
  if (!API_KEY) return []
  try {
    const res = await fetch(`https://${HOST}/exercises/exercise/${exdbId}`, { headers: HEADERS })
    if (!res.ok) return []
    const data = await res.json()
    const steps = (Array.isArray(data?.instructions) ? data.instructions : [])
      .map((s: unknown) => String(s).trim())
      .filter(Boolean)
    instructionsCache.set(exdbId, steps)
    return steps
  } catch {
    return []
  }
}
