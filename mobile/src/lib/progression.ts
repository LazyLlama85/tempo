// Tempo — adaptive progression engine.
// Turns a user's last performance on a lift into a concrete recommendation for
// the next session (go up / hold / back off), so the app answers the one
// question that matters: "what should I do next workout?"

import type { Goal } from '@/types'

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
 * session's sets. Autoregulated double progression:
 *   - cleared the top of the rep range at RPE ≤ 8  → add weight
 *   - hit reps but it was a grind (RPE ≥ 9.5) / fell short → hold or back off
 *   - readinessLow trims a set so a rough recovery day means less volume
 */
export function buildPrescription(
  last: SetPerformance[],
  goal: Goal,
  pattern: string,
  readinessLow = false,
  bias: -1 | 0 | 1 = 0,
): ExercisePrescription {
  const scheme = GOAL_SCHEME[goal] ?? GOAL_SCHEME.general_fitness
  let sets = scheme.sets
  if (readinessLow && sets > 2) sets -= 1
  // Workout-level feedback: "too easy" adds a set, "too hard" trims one.
  if (bias > 0) sets += 1
  else if (bias < 0 && sets > 2) sets -= 1

  const base = { sets, repLow: scheme.repLow, repHigh: scheme.repHigh, restSeconds: scheme.rest }

  if (!last.length) {
    return {
      ...base,
      suggestedWeight: null,
      direction: 'new',
      reason: 'First time — pick a weight you can control for every rep.',
      lastSummary: null,
    }
  }

  const lastSummary = last
    .map(s => (s.weight_lbs != null ? `${s.weight_lbs}×${s.reps}` : `${s.reps}`))
    .join(', ')

  const weighted = last.filter(s => s.weight_lbs != null && s.weight_lbs > 0) as
    (SetPerformance & { weight_lbs: number })[]

  if (!weighted.length) {
    return {
      ...base,
      suggestedWeight: null,
      direction: 'hold',
      reason: 'Log the weight you use so Tempo can progress you next time.',
      lastSummary,
    }
  }

  const topWeight = Math.max(...weighted.map(s => s.weight_lbs))
  const setsAtTop = weighted.filter(s => s.weight_lbs === topWeight)
  const minReps = Math.min(...setsAtTop.map(s => s.reps))
  const rpes = last.map(s => s.rpe).filter((r): r is number => r != null)
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null
  const inc = weightIncrement(pattern)

  // Cleared the top of the range and it wasn't maximal → progress the load,
  // unless the user just told us the last session was too hard (hold instead).
  if (minReps >= scheme.repHigh && (avgRpe == null || avgRpe <= 8)) {
    if (bias < 0) {
      return {
        ...base,
        suggestedWeight: topWeight,
        direction: 'hold',
        reason: `You said last session was tough — hold ${topWeight} lbs and own these reps.`,
        lastSummary,
      }
    }
    return {
      ...base,
      suggestedWeight: topWeight + inc,
      direction: 'up',
      reason: `You cleared ${scheme.repHigh} reps last time — add ${inc} lbs.`,
      lastSummary,
    }
  }

  // Fell short of the range, or every set was a maximal grind → back off.
  if (minReps < scheme.repLow || (avgRpe != null && avgRpe >= 9.5)) {
    return {
      ...base,
      suggestedWeight: roundToIncrement(topWeight * 0.9, inc),
      direction: 'down',
      reason: 'That was a grind — drop ~10% and rebuild with clean reps.',
      lastSummary,
    }
  }

  // In range → hold the weight and try to earn more reps before adding load.
  return {
    ...base,
    suggestedWeight: topWeight,
    direction: 'hold',
    reason: `Stay at ${topWeight} lbs and beat ${minReps} reps.`,
    lastSummary,
  }
}
