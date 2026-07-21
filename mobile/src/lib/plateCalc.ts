// Tempo — barbell plate-loading math (Pro).
//
// "245 lbs, 45+45+25+10 per side" — a target total weight in on the standard
// bar sizes, greedily filled from largest plate down. Pure math, no I/O.

import type { WeightUnit } from '@/lib/units'

export const STANDARD_BAR_LBS = 45
export const STANDARD_BAR_KG = 20

// Standard gym plate sets, largest first — greedy-fill order.
export const PLATES_LBS = [45, 35, 25, 10, 5, 2.5]
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25]

export interface PlateResult {
  barWeight: number
  perSide: number[]      // largest-first, one entry per plate loaded on ONE side
  loadedPerSide: number   // sum of perSide
  total: number           // bar + both sides
  exact: boolean          // false when the target can't be hit exactly with these plates
  remainder: number       // per-side weight left over when not exact (0 when exact)
}

/**
 * Greedily fills one side of the bar to reach `targetWeight` total (bar + both
 * sides). Rounds the required per-side weight to the nearest 0.5 before
 * filling — plates don't stack to arbitrary fractions, so an unreachable
 * target (e.g. an odd number with only 2.5s and up) reports its `exact: false`
 * remainder rather than silently overshooting or looping forever.
 */
export function calculatePlates(
  targetWeight: number,
  barWeight: number,
  unit: WeightUnit,
): PlateResult {
  const plates = unit === 'kg' ? PLATES_KG : PLATES_LBS
  const neededPerSide = Math.max(0, (targetWeight - barWeight) / 2)

  const perSide: number[] = []
  let remaining = Math.round(neededPerSide * 100) / 100
  for (const p of plates) {
    while (remaining + 1e-6 >= p) {
      perSide.push(p)
      remaining = Math.round((remaining - p) * 100) / 100
    }
  }

  const loadedPerSide = perSide.reduce((s, p) => s + p, 0)
  const exact = remaining <= 1e-6
  return {
    barWeight,
    perSide,
    loadedPerSide,
    total: barWeight + loadedPerSide * 2,
    exact,
    remainder: exact ? 0 : remaining,
  }
}

export function defaultBarWeight(unit: WeightUnit): number {
  return unit === 'kg' ? STANDARD_BAR_KG : STANDARD_BAR_LBS
}
