// Tempo — realistic workout-duration estimation.
//
// The old estimate (~40s work + ~75s rest per set, nothing else) was fantasy:
// a 7-exercise session "estimated 40 min" routinely takes ~67. Real gym time is
// dominated by rest at prescribed lengths, plus loading plates, walking between
// stations, waiting for equipment, and water breaks. Three layers here:
//
//   1. estimateSessionSec — static pre-session estimate:
//        per exercise: SETUP_SEC (transition/equipment/queue amortized)
//        per set:      work (timed sets use their duration; lifts ~40s) + rest
//   2. adaptiveRemainingSec — live during a session: blends the static per-set
//      cost with the pace the user is ACTUALLY logging at (elapsed / sets done),
//      trusting observed pace more as more sets land. The number sharpens as
//      the workout progresses instead of staying optimistic to the end.
//   3. fetchPaceFactor — historical learning: how this user's actual durations
//      compare to their planned ones over recent completed sessions. Multiplies
//      static estimates so a consistently-slower (or faster) user sees honest
//      numbers from the first exercise.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Amortized non-set time per exercise: setup, transitions, equipment waits. */
export const SETUP_SEC = 90
/** Typical time under tension for a strength set. */
export const WORK_SEC = 40
/** Default rest when nothing is prescribed (spec: suggest 2 minutes). */
export const DEFAULT_REST_SEC = 120

export interface EstimatableExercise {
  sets: number
  /** Prescribed rest between sets, seconds. */
  restSec?: number | null
  /** For timed work (planks, runs): seconds per set instead of WORK_SEC. */
  workSec?: number | null
}

/** Static whole-session estimate, in seconds. */
export function estimateSessionSec(exercises: EstimatableExercise[]): number {
  let sec = 0
  for (const ex of exercises) {
    const sets = Math.max(1, ex.sets)
    const work = ex.workSec && ex.workSec > 0 ? ex.workSec : WORK_SEC
    const rest = ex.restSec && ex.restSec > 0 ? ex.restSec : DEFAULT_REST_SEC
    sec += SETUP_SEC + sets * (work + rest)
  }
  // The final set of the day needs no rest after it.
  const last = exercises[exercises.length - 1]
  if (last) sec -= Math.min(sec, (last.restSec && last.restSec > 0 ? last.restSec : DEFAULT_REST_SEC))
  return Math.max(300, sec)
}

/** Static whole-session estimate, in minutes (for planned_duration_min etc.). */
export function estimateSessionMin(exercises: EstimatableExercise[]): number {
  return Math.max(5, Math.round(estimateSessionSec(exercises) / 60))
}

/**
 * Live "time remaining" during a session, in seconds.
 *
 * staticPerSetSec is the pre-session estimate divided by total sets. Once sets
 * are being logged, the observed seconds-per-set (which silently includes the
 * user's true rests, transitions and dawdling) is blended in — weight ramps to
 * ~85% observed after 6 logged sets.
 *
 * `elapsedSec` is WALL-CLOCK since the session opened, so `elapsed / doneSets`
 * is only a pace if the user was training the whole time. Very often they were
 * not: the app gets opened in the locker room, the phone goes down for a chat,
 * a warm-up runs long, someone takes a call. All of that idle time lands on the
 * first logged set and gets extrapolated across every remaining one. Observed
 * live: a 15-minute session left open ~57 minutes then logged one set displayed
 * **"~1 H 21 LEFT"**. The blend weight damps that but cannot bound it — at one
 * set the weight is only 1/7, yet a 57-minute "set" still adds ~8 minutes to
 * every remaining set. (The old docstring claimed one slow set "can't spike it";
 * it can, and did.)
 *
 * So the observation is clamped to a plausible band around the static estimate
 * before it is trusted. A genuinely slower user still reads slower — up to 3x,
 * which is far beyond any real training pace — but arithmetic that implies a
 * single set took the better part of an hour is rejected as what it is: idle
 * time, not evidence. Clamping (rather than resetting the clock on first log)
 * keeps this function pure and total, which is why it can be unit-tested.
 */
/** How far observed pace may stray from the static estimate before it's idle time, not pace. */
const OBSERVED_PACE_MIN_RATIO = 0.4
const OBSERVED_PACE_MAX_RATIO = 3

export function adaptiveRemainingSec(args: {
  elapsedSec: number
  doneSets: number
  totalSets: number
  staticPerSetSec: number
  paceFactor?: number
}): number {
  const { elapsedSec, doneSets, totalSets, staticPerSetSec } = args
  const pace = args.paceFactor ?? 1
  const remainingSets = Math.max(0, totalSets - doneSets)
  if (remainingSets === 0) return 0
  const staticPerSet = staticPerSetSec * pace
  if (doneSets === 0) return Math.round(remainingSets * staticPerSet)
  const rawObservedPerSet = elapsedSec / doneSets
  const observedPerSet = Math.min(
    staticPerSet * OBSERVED_PACE_MAX_RATIO,
    Math.max(staticPerSet * OBSERVED_PACE_MIN_RATIO, rawObservedPerSet),
  )
  const w = Math.min(0.85, doneSets / 7) // trust observation as evidence accrues
  const perSet = observedPerSet * w + staticPerSet * (1 - w)
  return Math.round(remainingSets * perSet)
}

/**
 * Historical pace factor: median(actual / planned) over the user's recent
 * completed sessions. 1 = estimates have been right; 1.3 = they run 30% long.
 * Clamped to [0.8, 1.6]; returns 1 with too little history or on any failure.
 */
export async function fetchPaceFactor(client: SupabaseClient, userId: string): Promise<number> {
  try {
    const { data } = await client
      .from('scheduled_workouts')
      .select('planned_duration_min, actual_duration_min')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .not('actual_duration_min', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(12)
    const ratios = ((data ?? []) as { planned_duration_min: number | null; actual_duration_min: number | null }[])
      .filter((r) => (r.planned_duration_min ?? 0) >= 10 && (r.actual_duration_min ?? 0) >= 10)
      .map((r) => (r.actual_duration_min as number) / (r.planned_duration_min as number))
      // A session resumed hours later logs an absurd duration — don't learn from it.
      .filter((x) => x > 0.4 && x < 3)
      .sort((a, b) => a - b)
    if (ratios.length < 3) return 1
    const median = ratios[Math.floor(ratios.length / 2)]
    return Math.min(1.6, Math.max(0.8, median))
  } catch {
    return 1
  }
}

/** "22 min" / "1 h 05" — friendly remaining-time label. */
export function formatRemaining(sec: number): string {
  const min = Math.max(0, Math.round(sec / 60))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h} h ${String(m).padStart(2, '0')}`
}
