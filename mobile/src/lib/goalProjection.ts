// Tempo — goal countdown / projection.
//
// People love a progress bar with an ETA. From the user's goal + their real
// trends (weight rate, current strength) this produces a single, honest line like
// "At your current pace: 12 weeks to lose 10 lbs" or "6 weeks until a projected
// 225 bench". Returns null when there isn't enough signal, so the card just hides.

import type { Goal, Experience } from '@/types'

export interface GoalProjection {
  headline: string         // the big line, e.g. "12 weeks to lose 10 lbs"
  sub: string              // the basis, e.g. "At your current pace of −0.8 lb/week"
  pct: number | null       // optional progress toward the target (0–100)
  icon: string             // Ionicons name
}

// Weekly strength progression assumed for a main lift, by training age.
const STRENGTH_RATE: Record<Experience, number> = { beginner: 5, intermediate: 2.5, advanced: 1 }

// Next round milestone at or above a lift (25-lb steps; classic 225 if just under).
function nextMilestone(current: number): number {
  if (current < 225 && current >= 185) return 225
  return Math.ceil((current + 1) / 25) * 25
}

export function projectGoal(args: {
  goal: Goal
  experience?: Experience | null
  weightPerWeek: number | null
  benchMax: number | null
}): GoalProjection | null {
  const { goal, weightPerWeek, benchMax } = args
  const experience = args.experience ?? 'beginner'

  const fmtRate = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(1)} lb/week`

  // ── Fat loss: weeks to drop 10 lbs at the current rate ──────────────────────
  if (goal === 'fat_loss') {
    if (weightPerWeek != null && weightPerWeek < -0.1) {
      const weeks = Math.max(1, Math.ceil(10 / Math.abs(weightPerWeek)))
      return { headline: `${weeks} weeks to lose 10 lbs`, sub: `At your current pace of ${fmtRate(weightPerWeek)}`, pct: null, icon: 'trending-down-outline' }
    }
    return { headline: 'Log your weight to see your ETA', sub: 'Tempo projects your fat-loss timeline from your trend.', pct: null, icon: 'scale-outline' }
  }

  // ── Muscle gain: weeks to add 5 lbs of bodyweight at the current rate ────────
  if (goal === 'muscle_gain') {
    if (weightPerWeek != null && weightPerWeek > 0.05) {
      const weeks = Math.max(1, Math.ceil(5 / weightPerWeek))
      return { headline: `${weeks} weeks to gain 5 lbs`, sub: `At your current pace of ${fmtRate(weightPerWeek)}`, pct: null, icon: 'trending-up-outline' }
    }
    // Fall through to a strength projection if we have a max.
  }

  // ── Strength / athletic (and muscle_gain fallback): time to a bench milestone ─
  if ((goal === 'strength' || goal === 'athletic' || goal === 'muscle_gain') && benchMax && benchMax > 0) {
    const target = nextMilestone(benchMax)
    const rate = STRENGTH_RATE[experience]
    const weeks = Math.max(1, Math.ceil((target - benchMax) / rate))
    const pct = Math.round((benchMax / target) * 100)
    return { headline: `${weeks} weeks to a projected ${target} bench`, sub: `From your ${benchMax} lb max at steady progression`, pct, icon: 'barbell-outline' }
  }

  // ── General fitness / not enough signal: lean on the weight trend if any ──────
  if (weightPerWeek != null && Math.abs(weightPerWeek) >= 0.1) {
    const dir = weightPerWeek < 0 ? 'lose' : 'gain'
    const weeks = Math.max(1, Math.ceil(5 / Math.abs(weightPerWeek)))
    return { headline: `${weeks} weeks to ${dir} 5 lbs`, sub: `At your current pace of ${fmtRate(weightPerWeek)}`, pct: null, icon: 'fitness-outline' }
  }

  return null
}
