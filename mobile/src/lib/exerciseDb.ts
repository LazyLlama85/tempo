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
// first open and caches them in-memory for the session, PLUS persists a
// successful fetch back to the row (via the save_exercise_instructions RPC —
// add_exercise_instructions_backfill_rpc.sql) so every future viewer reads it
// straight from the database instead of hitting RapidAPI's limited monthly
// quota again. A real, lazy, real-usage-driven backfill that runs alongside
// (not instead of) the founder's manual monthly script.

import { supabase } from '@/lib/supabase'

// Routed through our own `exercise-media` edge function rather than calling
// RapidAPI directly, so the billable RapidAPI key lives on the server instead of
// being inlined into every shipped bundle (and, until 2026-09-06, sitting in a
// public repo). See supabase/functions/exercise-media.
const MEDIA_FN = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/exercise-media`
const MEDIA_AUTH = {
  Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''}`,
}
const MEDIA_CONFIGURED = !!process.env.EXPO_PUBLIC_SUPABASE_URL

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
// `exerciseId` (the app's own row id) is only used to persist a successful
// fetch back to the database — pass it whenever available so the fetch never
// has to happen again for that exercise, for anyone.
export async function fetchRemoteInstructions(exdbId: string, exerciseId?: string): Promise<string[]> {
  const cached = instructionsCache.get(exdbId)
  if (cached) return cached
  if (!MEDIA_CONFIGURED) return []
  try {
    const res = await fetch(
      `${MEDIA_FN}?kind=instructions&id=${encodeURIComponent(exdbId)}`,
      { headers: MEDIA_AUTH },
    )
    if (!res.ok) return []
    const data = await res.json()
    const steps = (Array.isArray(data?.instructions) ? data.instructions : [])
      .map((s: unknown) => String(s).trim())
      .filter(Boolean)
    instructionsCache.set(exdbId, steps)
    if (steps.length && exerciseId) {
      // Best-effort — a failed write just means the next viewer fetches live
      // again, same as today; never blocks the instructions from showing.
      supabase.rpc('save_exercise_instructions', { p_exercise_id: exerciseId, p_instructions: steps }).then(
        () => {},
        () => {},
      )
    }
    return steps
  } catch {
    return []
  }
}
