// Tempo — workout-level difficulty feedback ("that was too easy / too hard").
// This is the coarse, human signal that sits on top of the per-set RPE
// progression: when a whole session felt off, we bias the next one's volume so
// the plan visibly responds instead of marching on regardless.
//
// Persisted in the existing adaptation_events audit table (no migration needed).

import type { SupabaseClient } from '@supabase/supabase-js'

export type WorkoutFeel = 'too_easy' | 'just_right' | 'too_hard'

// -1 trims volume next session, +1 adds it, 0 leaves it alone.
export type IntensityBias = -1 | 0 | 1

export function feelToBias(feel: WorkoutFeel): IntensityBias {
  return feel === 'too_easy' ? 1 : feel === 'too_hard' ? -1 : 0
}

export async function recordWorkoutFeedback(
  client: SupabaseClient,
  userId: string,
  feel: WorkoutFeel,
): Promise<void> {
  const bias = feelToBias(feel)
  const action = feel === 'too_easy' ? 'intensity_up' : feel === 'too_hard' ? 'volume_down' : 'maintain'
  try {
    await client.from('adaptation_events').insert({
      user_id: userId,
      trigger: 'workout_feedback',
      trigger_details: { feel, bias },
      action_taken: action,
    })
  } catch {
    // Best-effort — feedback should never block finishing a workout.
  }
}

// The most recent feedback the user gave. Drives the next session's volume until
// they give a new signal. Never throws (table/RLS issues degrade to 'no bias').
export async function getIntensityBias(client: SupabaseClient, userId: string): Promise<IntensityBias> {
  try {
    const { data } = await client
      .from('adaptation_events')
      .select('trigger_details')
      .eq('user_id', userId)
      .eq('trigger', 'workout_feedback')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const bias = (data?.trigger_details as { bias?: number } | null)?.bias
    return bias === 1 || bias === -1 ? bias : 0
  } catch {
    return 0
  }
}
