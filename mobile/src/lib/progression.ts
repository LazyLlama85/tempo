// Tempo — adaptive progression engine.
// Turns a user's last performance on a lift into a concrete recommendation for
// the next session (go up / hold / back off), so the app answers the one
// question that matters: "what should I do next workout?"

import type { Goal, Experience } from '@/types'
import type { WeekProgression } from '@/lib/periodization'
import { roleRepMod, slotRepMod, type Role, type Slot } from '@/lib/exerciseProgramming'
import { titrateForWeeklyVolume, isLandmarkMuscleGroup } from '@/lib/volumeLandmarks'

export interface SetPerformance {
  weight_lbs: number | null
  reps: number
  rpe: number | null
}

export type ProgressionDirection = 'new' | 'up' | 'hold' | 'down'

export interface ExercisePrescription {
  sets: number
  repLow: number
  repHigh: number
  restSeconds: number
  suggestedWeight: number | null
  direction: ProgressionDirection
  reason: string
  lastSummary: string | null      // "185×8, 185×7, 185×6"
}

// Goal-specific rep/rest schemes — these mirror standard hypertrophy/strength
// programming and the ranges referenced in the product brief. Rest is the real
// inter-set rest a lifter should take (strength holds a full 3 min; hypertrophy
// ~90 s), and it's what drives the session-duration estimate below.
const GOAL_SCHEME: Record<Goal, { sets: number; repLow: number; repHigh: number; rest: number }> = {
  muscle_gain:     { sets: 3, repLow: 8,  repHigh: 12, rest: 90 },
  strength:        { sets: 4, repLow: 3,  repHigh: 6,  rest: 180 },
  fat_loss:        { sets: 3, repLow: 12, repHigh: 15, rest: 45 },
  general_fitness: { sets: 3, repLow: 10, repHigh: 12, rest: 75 },
  athletic:        { sets: 4, repLow: 5,  repHigh: 8,  rest: 150 },
}

export function goalScheme(goal: Goal) {
  return GOAL_SCHEME[goal] ?? GOAL_SCHEME.general_fitness
}

// ── Session duration model ────────────────────────────────────────────────────
// A realistic wall-clock estimate for a whole session, from the goal's actual set
// count and inter-set rest — so "45 min" reflects sets × (work + 2–3 min rest),
// not a flat guess. Used by plan generation so the time shown matches the work.
const WORK_SECONDS_PER_SET = 45     // one working set, incl. the lift itself
const TRANSITION_SECONDS = 75       // change stations / load plates between lifts
const WARMUP_SECONDS = 360          // general warm-up + first-lift ramp-up sets

export function estimateSessionMinutes(exerciseCount: number, goal: Goal, isDeload = false): number {
  if (exerciseCount <= 0) return 0
  const { sets, rest } = goalScheme(goal)
  const effectiveSets = Math.max(2, isDeload ? sets - 1 : sets)
  const perExercise = effectiveSets * WORK_SECONDS_PER_SET + (effectiveSets - 1) * rest + TRANSITION_SECONDS
  const total = WARMUP_SECONDS + exerciseCount * perExercise
  return Math.max(10, Math.round(total / 60))
}

// Invert the model: how many exercises fit the user's preferred session length for
// this goal (clamped to a sane 3–7). A strength user asking for 45 min gets fewer,
// heavier lifts with full rest; a fat-loss user gets more, because rest is short.
export function exerciseCountForDuration(preferredMinutes: number, goal: Goal): number {
  const target = Math.max(15, Math.min(120, preferredMinutes || 45))
  let best = 3
  let bestGap = Infinity
  for (let n = 3; n <= 7; n++) {
    const gap = Math.abs(estimateSessionMinutes(n, goal) - target)
    if (gap < bestGap) { bestGap = gap; best = n }
  }
  return best
}

// Epley 1RM estimate — used for PR tracking and strength trends.
export function estimate1RM(weight: number, reps: number): number {
  if (reps <= 1) return Math.round(weight)
  return Math.round(weight * (1 + reps / 30))
}

// Lower-body compound lifts can absorb bigger jumps than upper-body work.
function weightIncrement(pattern: string): number {
  return pattern === 'squat' || pattern === 'hinge' ? 10 : 5
}

function roundToIncrement(weight: number, inc: number): number {
  return Math.max(inc, Math.round(weight / inc) * inc)
}

/**
 * Build the next-session prescription for one exercise from its most recent
 * session's sets. Two layers combine here:
 *
 *   1. Autoregulated double progression (reactive load):
 *      - cleared the top of the rep range at RPE ≤ 8  → add weight
 *      - hit reps but it was a grind (RPE ≥ 9.5) / fell short → hold or back off
 *      - readinessLow trims a set so a rough recovery day means less volume
 *   2. Periodization (`period`, optional — the week's place in the mesocycle):
 *      adds/removes a planned set, shifts the rep target, and on a deload week
 *      explicitly lightens the load and overrides the call to "back off".
 *   3. Volume landmarks (`weeklyVolume`, optional, B5.4): caps this exercise's
 *      sets so the muscle group's REAL completed volume this week never blows
 *      past its weekly MRV — a safety ceiling only; omit it and nothing changes.
 */
export function buildPrescription(
  last: SetPerformance[],
  goal: Goal,
  pattern: string,
  readinessLow = false,
  bias: -1 | 0 | 1 = 0,
  period?: WeekProgression | null,
  role?: Role | null,
  weeklyVolume?: { group: string | null; setsThisWeek: number; experience?: Experience } | null,
  slot?: Slot | null,
): ExercisePrescription {
  const scheme = GOAL_SCHEME[goal] ?? GOAL_SCHEME.general_fitness
  const inc = weightIncrement(pattern)
  // The exercise's ROLE shapes the scheme within the goal: a primary compound
  // stays heavier/lower-rep with full rest; an isolation goes higher-rep with
  // shorter rest; core higher still. Base goal numbers are the anchor.
  const mod = role ? roleRepMod(role) : { setsDelta: 0, repLowDelta: 0, repHighDelta: 0, restMult: 1 }

  let sets = scheme.sets + mod.setsDelta
  if (readinessLow && sets > 2) sets -= 1
  // Workout-level feedback: "too easy" adds a set, "too hard" trims one.
  if (bias > 0) sets += 1
  else if (bias < 0 && sets > 2) sets -= 1
  // Periodized volume wave (peak week adds a set, deload removes one).
  if (period) sets += period.setsDelta
  sets = Math.max(2, Math.min(6, sets))

  // Volume-landmark cap (B5.4) — a safety ceiling on top of everything above,
  // never a floor: it can only reduce sets, and only when the weekly total
  // would otherwise exceed this muscle group's MRV.
  let volumeNote: string | undefined
  if (weeklyVolume && isLandmarkMuscleGroup(weeklyVolume.group)) {
    const t = titrateForWeeklyVolume(sets, weeklyVolume.group, weeklyVolume.setsThisWeek, weeklyVolume.experience)
    sets = t.sets
    if (t.capped) volumeNote = t.note
  }

  // Role- then periodization-adjusted rep target (deload trims the range).
  // A few slots (currently just calves) need a further bump on top of the
  // generic isolation range — see slotRepMod's own comment for why.
  const slotMod = slot ? slotRepMod(slot) : null
  let repLow = Math.max(1, scheme.repLow + mod.repLowDelta + (slotMod?.repLowDelta ?? 0))
  let repHigh = Math.max(repLow + 1, scheme.repHigh + mod.repHighDelta + (slotMod?.repHighDelta ?? 0))
  if (period?.repBias) {
    repLow = Math.max(1, repLow + period.repBias)
    repHigh = Math.max(repLow + 1, repHigh + period.repBias)
  }

  const restSeconds = Math.max(30, Math.round(scheme.rest * mod.restMult))
  const base = { sets, repLow, repHigh, restSeconds }

  // Scale a working weight by the week's intensity (1.0 except on a deload).
  const scaleLoad = (w: number | null): number | null =>
    w == null || !period || period.intensityPct === 1 ? w : roundToIncrement(w * period.intensityPct, inc)

  // ── Decide the autoregulated baseline (weight / direction / reason) ──────────
  const lastSummary = last.length
    ? last.map(s => (s.weight_lbs != null ? `${s.weight_lbs}×${s.reps}` : `${s.reps}`)).join(', ')
    : null

  let suggestedWeight: number | null = null
  let direction: ProgressionDirection = 'new'
  let reason = 'First time — pick a weight you can control for every rep.'
  // The actual last-used top weight, BEFORE any reactive up/down adjustment —
  // what a deload below must cut FROM. See the deload override below.
  let baselineWeight: number | null = null

  const weighted = last.filter(s => s.weight_lbs != null && s.weight_lbs > 0) as
    (SetPerformance & { weight_lbs: number })[]

  if (last.length && !weighted.length) {
    direction = 'hold'
    reason = 'Log the weight you use so Tempo can progress you next time.'
  } else if (weighted.length) {
    const topWeight = Math.max(...weighted.map(s => s.weight_lbs))
    baselineWeight = topWeight
    const setsAtTop = weighted.filter(s => s.weight_lbs === topWeight)
    const minReps = Math.min(...setsAtTop.map(s => s.reps))
    const rpes = last.map(s => s.rpe).filter((r): r is number => r != null)
    const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null

    if (minReps >= repHigh && (avgRpe == null || avgRpe <= 8)) {
      if (bias < 0) {
        suggestedWeight = topWeight
        direction = 'hold'
        reason = `You said last session was tough — hold ${topWeight} lbs and own these reps.`
      } else {
        suggestedWeight = topWeight + inc
        direction = 'up'
        reason = `You cleared ${repHigh} reps last time — add ${inc} lbs.`
      }
    } else if (minReps < repLow || (avgRpe != null && avgRpe >= 9.5)) {
      suggestedWeight = roundToIncrement(topWeight * 0.9, inc)
      direction = 'down'
      reason = 'That was a grind — drop ~10% and rebuild with clean reps.'
    } else {
      suggestedWeight = topWeight
      direction = 'hold'
      reason = `Stay at ${topWeight} lbs and beat ${minReps} reps.`
    }
  }

  // ── Deload override: lighten the load and reframe the session as recovery ────
  // Fixed 2026-08-02: this used to scale `suggestedWeight`, which on a session
  // that ALSO tripped the reactive "that was a grind" cut (line ~195, topWeight
  // * 0.9) was already reduced — compounding the two cuts (e.g. a 200 lb top
  // weight became 155 lb, ~23.5% off, instead of the intended flat 15% deload
  // cut to 170 lb). A deload is a clean cut from what was ACTUALLY lifted last
  // time (`baselineWeight`), never stacked on top of a same-session reactive
  // adjustment — matching CLAUDE.md's documented invariant that the reactive
  // layer and the periodization layer never double-count (planned intensity
  // only deviates from 1.0 on a deload).
  if (period?.isDeload && (suggestedWeight != null || direction !== 'new')) {
    return {
      ...base,
      suggestedWeight: scaleLoad(baselineWeight ?? suggestedWeight),
      direction: 'down',
      reason: volumeNote ? `${period.note} ${volumeNote}` : period.note,
      lastSummary,
    }
  }

  return {
    ...base,
    suggestedWeight: scaleLoad(suggestedWeight),
    direction,
    reason: volumeNote ? `${reason} ${volumeNote}` : reason,
    lastSummary,
  }
}
