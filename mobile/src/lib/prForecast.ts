// Tempo — per-lift PR forecast (LAUNCH_SCORE_PLAN.md T2.1).
//
// Charts are retrospective — they say what already happened. This is the payable
// half: a real, honest projection of what happens NEXT, from the user's own
// logged sets on ONE lift ("at this rate you'll hit a 2-plate bench by October").
// MONETIZATION_PLAN.md Pillar 2: "the audit is right that charts should be free;
// foresight is the Pro half." exercise-progress.tsx's trend chart stays free;
// this is the Pro-gated card underneath it.
//
// Deliberately NOT the same shape as goalProjection.ts's Home banner, which uses
// a fixed assumed rate by experience level (STRENGTH_RATE) because it only has a
// single bench-max number to work with. Here we have a real per-session e1RM
// history for the specific lift the user is looking at, so the honest and more
// accurate move is to fit an actual trend line to it rather than assume a rate.

import { nextMilestone } from './goalProjection'

export interface PRForecastPoint {
  date: Date
  /** Estimated 1RM in lbs for that session. */
  e1rm: number
}

export interface PRForecast {
  /** The next round-number milestone this lift is projected to reach, in lbs. */
  targetLbs: number
  /** When, at the current rate — a real calendar date, not "N weeks". */
  projectedDate: Date
  /** "October 15" — for the headline. */
  projectedDateLabel: string
  /** Lbs/week the least-squares fit found. Always > 0 (a forecast is never shown otherwise). */
  ratePerWeek: number
}

const MS_PER_WEEK = 7 * 86_400_000

// Below this many sessions, or this short a window, a "trend" is noise — two
// good days in a row is not a trend line. Matches the honest-hide pattern
// goalProjection.ts already uses (return null rather than a shaky number).
const MIN_POINTS = 4
const MIN_SPAN_DAYS = 14
// A projection further out than this reads as noise dressed up as foresight,
// not a payable insight — hide it rather than promise a 3-year plateau-free run.
const MAX_WEEKS_OUT = 52

/**
 * Least-squares fit of e1RM over time, projected to the next milestone.
 * Returns null whenever the data doesn't support an honest forecast — too few
 * points, too short a window, a flat/declining trend, or a projection so far
 * out it stops being useful. Never fabricates a number to fill the card.
 */
export function computePRForecast(points: PRForecastPoint[], now: Date = new Date()): PRForecast | null {
  if (points.length < MIN_POINTS) return null

  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime())
  const first = sorted[0].date.getTime()
  const last = sorted[sorted.length - 1].date.getTime()
  if (last - first < MIN_SPAN_DAYS * 86_400_000) return null

  // x = days since the first point (keeps the numbers small and stable),
  // y = e1RM. Standard least-squares slope/intercept.
  const xs = sorted.map((p) => (p.date.getTime() - first) / 86_400_000)
  const ys = sorted.map((p) => p.e1rm)
  const n = xs.length
  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0)
  const sumXX = xs.reduce((a, x) => a + x * x, 0)
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return null // all points on the same day — can't fit a slope

  const slopePerDay = (n * sumXY - sumX * sumY) / denom
  const ratePerWeek = slopePerDay * 7
  // Only ever forecast forward progress. A flat or declining trend is real and
  // worth showing elsewhere (the existing delta chip already does), but it is
  // not a "you'll hit X by Y" moment — hide the card rather than force one.
  if (ratePerWeek <= 0.05) return null

  const intercept = (sumY - slopePerDay * sumX) / n
  const currentFit = intercept + slopePerDay * xs[xs.length - 1] // fitted value "today", not the noisy last point
  const target = nextMilestone(Math.round(currentFit))
  const weeksOut = (target - currentFit) / ratePerWeek
  if (!Number.isFinite(weeksOut) || weeksOut <= 0 || weeksOut > MAX_WEEKS_OUT) return null

  const projectedDate = new Date(now.getTime() + weeksOut * MS_PER_WEEK)

  return {
    targetLbs: target,
    projectedDate,
    projectedDateLabel: projectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
    ratePerWeek: Math.round(ratePerWeek * 10) / 10,
  }
}
