// Tempo — permanent per-user exercise exclusion (add_excluded_exercises.sql).
//
// "Skip for today" only ever removes an exercise from today's session; this
// is the "never program this for me again" list, checked by every exercise-
// selection path that produces scheduled_workouts.exercise_ids.

import type { SupabaseClient } from '@supabase/supabase-js'

export async function fetchExcludedExerciseIds(client: SupabaseClient, userId: string): Promise<Set<string>> {
  try {
    const { data } = await client
      .from('user_profiles')
      .select('excluded_exercise_ids')
      .eq('user_id', userId)
      .maybeSingle()
    return new Set((data?.excluded_exercise_ids ?? []) as string[])
  } catch {
    return new Set() // optional column may not exist yet — exclude nothing rather than fail generation
  }
}

/** Permanently exclude an exercise from every future plan/split/quick-workout generation. */
export async function excludeExercisePermanently(client: SupabaseClient, userId: string, exerciseId: string): Promise<void> {
  const current = await fetchExcludedExerciseIds(client, userId)
  if (current.has(exerciseId)) return
  current.add(exerciseId)
  await client.from('user_profiles').update({ excluded_exercise_ids: [...current] }).eq('user_id', userId)
}
