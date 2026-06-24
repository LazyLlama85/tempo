// Tempo — adaptive progression engine.
// Turns a user's last performance on a lift into a concrete recommendation for
// the next session (go up / hold / back off), so the app answers the one
// question that matters: "what should I do next workout?"

import type { Goal } from '@/types'
import type { WeekProgression } from '@/lib/periodization'

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
// programming and the ranges referenced in the product brief.
const GOAL_SCHEME: Record<Goal, { sets: number; repLow: number; repHigh: number; rest: number }> = {
  muscle_gain:     { sets: 3, repLow: 8,  repHigh: 12, rest: 90 },
  strength:        { sets: 4, repLow: 3,  repHigh: 6,  rest: 180 },
  fat_loss:        { sets: 3, repLow: 12, repHigh: 15, rest: 45 },
  general_fitness: { sets: 3, repLow: 10, repHigh: 12, rest: 60 },
  athletic:        { sets: 4, repLow: 5,  repHigh: 8,  rest: 120 },
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
 */
export function buildPrescription(
  last: SetPerformance[],
  goal: Goal,
  pattern: string,
  readinessLow = false,
  bias: -1 | 0 | 1 = 0,
  period?: WeekProgression | null,
): ExercisePrescription {
  const scheme = GOAL_SCHEME[goal] ?? GOAL_SCHEME.general_fitness
  const inc = weightIncrement(pattern)

  let sets = scheme.sets
  if (readinessLow && sets > 2) sets -= 1
  // Workout-level feedback: "too easy" adds a set, "too hard" trims one.
  if (bias > 0) sets += 1
  else if (bias < 0 && sets > 2) sets -= 1
  // Periodized volume wave (peak week adds a set, deload removes one).
  if (period) sets += period.setsDelta
  sets = Math.max(2, Math.min(6, sets))

  // Periodized rep target shift (deload trims the range).
  let repLow = scheme.repLow
  let repHigh = scheme.repHigh
  if (period?.repBias) {
    repLow = Math.max(1, repLow + period.repBias)
    repHigh = Math.max(repLow + 1, repHigh + period.repBias)
  }

  const base = { sets, repLow, repHigh, restSeconds: scheme.rest }

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

  const weighted = last.filter(s => s.weight_lbs != null && s.weight_lbs > 0) as
    (SetPerformance & { weight_lbs: number })[]

  if (last.length && !weighted.length) {
    direction = 'hold'
    reason = 'Log the weight you use so Tempo can progress you next time.'
  } else if (weighted.length) {
    const topWeight = Math.max(...weighted.map(s => s.weight_lbs))
    const setsAtTop = weighted.filter(s => s.weight_lbs === topWeight)
    const minReps = Math.min(...setsAtTop.map(s => s.reps))
    const rpes = last.map(s => s.rpe).filter((r): r is number => r != null)
    const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null

    if (minReps >= scheme.repHigh && (avgRpe == null || avgRpe <= 8)) {
      if (bias < 0) {
        suggestedWeight = topWeight
        direction = 'hold'
        reason = `You said last session was tough — hold ${topWeight} lbs and own these reps.`
      } else {
        suggestedWeight = topWeight + inc
        direction = 'up'
        reason = `You cleared ${scheme.repHigh} reps last time — add ${inc} lbs.`
      }
    } else if (minReps < scheme.repLow || (avgRpe != null && avgRpe >= 9.5)) {
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
  if (period?.isDeload && (suggestedWeight != null || direction !== 'new')) {
    return {
      ...base,
      suggestedWeight: scaleLoad(suggestedWeight),
      direction: 'down',
      reason: period.note,
      lastSummary,
    }
  }

  return { ...base, suggestedWeight: scaleLoad(suggestedWeight), direction, reason, lastSummary }
}
