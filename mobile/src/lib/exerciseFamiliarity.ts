// Arclo — what the user has actually trained before.
//
// Founder, 2026-09-04: "it would also be helpful to give workouts people are
// familiar with based on what they have done, not just random things, but also
// not always the same, good to do exercises that are new if helpful."
//
// Both selection engines (generatePlan's slot filler and Quick Workout's pattern
// picker) ranked candidates purely on properties of the EXERCISE — how many
// muscles it works, how popular it is, what equipment it wants. Nothing anywhere
// looked at what this particular person had ever done. So a lifter six weeks in
// could still be handed a movement they had never seen, ranked above the one they
// have done twenty times, for no reason they could perceive.
//
// This module supplies the missing input. It answers one question — "how many
// separate sessions has this person performed this exercise in?" — and leaves the
// ranking policy to the engines that consume it.
//
// The balance the founder asked for has three parts, and they pull against each
// other, so they are handled separately:
//
//   familiar   — rank known movements first, so a session reads like YOUR training
//   varied     — the engines already rotate their picks by a per-day seed, which
//                is preserved untouched; familiarity is a tiebreak layer over it,
//                not a replacement for it
//   new        — one slot per session may deliberately go to something unseen,
//                but only for someone with enough of a base to benefit (see
//                `noveltySlotIndex`). A beginner meeting everything for the first
//                time needs no help discovering new exercises.
//
// The no-history case is a deliberate exact no-op: every count is 0, every
// candidate ties, and the engines' existing ordering survives byte-for-byte. New
// users get precisely the behaviour they got before this existed.

import type { SupabaseClient } from '@supabase/supabase-js'
import { captureApiError } from '@/lib/crashReporting'

/** How far back counts as "familiar". Older than this and it isn't fresh knowledge. */
const HISTORY_DAYS = 180
/** Cap on sessions read, so a long-time user's lookup stays a small query. */
const MAX_LOGS = 300

/**
 * How many DISTINCT exercises someone must have performed before it is worth
 * spending a slot on something new. Below this they are still building a base
 * and every session already contains unfamiliar work.
 */
export const MIN_KNOWN_FOR_NOVELTY = 8
/** Sessions shorter than this have no room to spend a slot on an experiment. */
export const MIN_PICKS_FOR_NOVELTY = 4

export interface FamiliarityIndex {
  /** Separate sessions this exercise has been performed in. 0 = never. */
  sessions: (exerciseId: string) => number
  /** Distinct exercises performed at least once. */
  known: number
}

/** Someone with no logged history — every lookup is 0, so all ranking ties. */
export const NO_HISTORY: FamiliarityIndex = { sessions: () => 0, known: 0 }

/**
 * Build the index from raw `set_logs` rows. Pure, so the counting rules are
 * unit-tested rather than inferred from behaviour.
 *
 * Counts SESSIONS, not sets: doing five sets of one lift in one workout is one
 * exposure to it, not five, and counting sets would let a single high-volume day
 * outrank a movement done every week for a month.
 */
export function buildFamiliarity(
  rows: { exercise_id: string | null; workout_log_id: string | null }[],
): FamiliarityIndex {
  const seen = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r.exercise_id || !r.workout_log_id) continue
    const logs = seen.get(r.exercise_id) ?? new Set<string>()
    logs.add(r.workout_log_id)
    seen.set(r.exercise_id, logs)
  }
  return {
    sessions: (id: string) => seen.get(id)?.size ?? 0,
    known: seen.size,
  }
}

/**
 * Load this user's exercise history. Best-effort: selection must still work when
 * this fails, so any error degrades to NO_HISTORY (i.e. the old behaviour) rather
 * than breaking plan generation.
 */
export async function loadFamiliarity(
  client: SupabaseClient,
  userId: string,
): Promise<FamiliarityIndex> {
  try {
    const since = new Date()
    since.setDate(since.getDate() - HISTORY_DAYS)

    // set_logs has no user_id of its own — it reaches the user through
    // workout_logs, the same two-step weeklyReport and wrapped already use.
    const { data: logs } = await client
      .from('workout_logs')
      .select('id')
      .eq('user_id', userId)
      .gte('completed_at', since.toISOString())
      .order('completed_at', { ascending: false })
      .limit(MAX_LOGS)

    const ids = (logs ?? []).map((l) => l.id as string)
    if (!ids.length) return NO_HISTORY

    const { data: sets } = await client
      .from('set_logs')
      .select('exercise_id, workout_log_id')
      .in('workout_log_id', ids)
      .not('is_warmup', 'is', true)

    return buildFamiliarity(sets ?? [])
  } catch (e) {
    captureApiError('loadFamiliarity', e)
    return NO_HISTORY
  }
}

/**
 * Which pick in a session of `total` should deliberately go to something the user
 * has never done, or null for "none of them".
 *
 * The last slot, because a new movement belongs after the work that matters, not
 * in the primary position where the user is strongest and most invested.
 *
 * Returns null for anyone without a real base (`MIN_KNOWN_FOR_NOVELTY`) or in a
 * session too short to spare the slot (`MIN_PICKS_FOR_NOVELTY`) — which is what
 * makes this "new if helpful" rather than novelty for its own sake.
 */
export function noveltySlotIndex(fam: FamiliarityIndex, total: number): number | null {
  if (fam.known < MIN_KNOWN_FOR_NOVELTY) return null
  if (total < MIN_PICKS_FOR_NOVELTY) return null
  return total - 1
}

/**
 * Comparator fragment ordering `a` before `b` by familiarity. Returns 0 when they
 * are equally familiar, so callers chain it ahead of their existing tiebreaks and
 * keep all previous ordering intact underneath.
 *
 * Buckets rather than raw counts: "done it before" is the signal that matters, and
 * sorting on exact counts would freeze the single most-performed lift into first
 * place forever, which is precisely the "always the same" failure to avoid. Within
 * a bucket the engines' own rotation still decides.
 */
export function byFamiliarity(
  a: string, b: string, fam: FamiliarityIndex, preferNew = false,
): number {
  const known = (id: string) => (fam.sessions(id) > 0 ? 1 : 0)
  const diff = known(b) - known(a)
  return preferNew ? -diff : diff
}
