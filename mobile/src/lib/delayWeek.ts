// Tempo — "Delay whole week" (pure, no I/O → unit-testable).
//
// The literal companion to `weekReschedule.ts`'s recovery-aware re-optimizer:
// instead of choosing a new best day for each workout, this pushes every
// remaining session in the CURRENT calendar week later by the SAME fixed
// number of days — same relative spacing, same times, just later. Meant for
// a sick day, a trip, or a week that's simply overloaded, where the user
// wants their whole week to slide, not be re-planned.
//
// Deliberately scoped to ONLY this week: a shift is capped so no workout can
// land past the week's last day (Saturday, Sunday-start week — matches the
// Plan tab's own week strip). That guarantees it never bleeds into or
// collides with next week's already-scheduled workouts, and never needs to
// search for calendar-free slots or re-optimize anything — it's a pure date
// shift. The DB + calendar I/O that feeds it lives in `reschedule.ts`
// (`delayWholeWeek` / `getDelayWeekInfo`).

import { addDays, daysBetween, weekEndStr } from '@/lib/dates'

export const MAX_DELAY_OFFERED_DAYS = 6 // a week only has 7 days; offering more is meaningless

export interface DelayableWorkout {
  id: string
  date: string // current planned_date ('YYYY-MM-DD')
}

export interface DelayAssignment {
  id: string
  date: string   // new 'YYYY-MM-DD'
  changed: boolean
}

// The largest offset (in days) that's safe to apply to EVERY workout in
// `dates` without any of them landing past this week's last day. 0 means
// nothing can be delayed this week (the latest workout is already on the
// week's final day). Ignores dates that are already past `todayStr` — pass
// only workouts you intend to consider (matches the caller's own eligibility
// filter, same as `planWeekReschedule`'s contract).
export function computeMaxDelayDays(dates: string[], todayStr: string): number {
  if (!dates.length) return 0
  const weekEnd = weekEndStr(todayStr)
  const latest = dates.reduce((a, b) => (b > a ? b : a))
  return Math.max(0, daysBetween(latest, weekEnd))
}

// Shift every workout by `offsetDays`. Defensive per-workout clamp: if a
// workout's shifted date would land past this week's last day, it's left
// unchanged (`changed: false`) rather than pushed out of the week — this
// should never trigger when the caller respects `computeMaxDelayDays`, but
// guards against stale/racy input the same way `planWeekReschedule` never
// drops a session it can't safely place. A non-positive offset is a no-op.
export function planDelayWeek(
  workouts: DelayableWorkout[],
  todayStr: string,
  offsetDays: number,
): DelayAssignment[] {
  const weekEnd = weekEndStr(todayStr)
  if (!Number.isFinite(offsetDays) || offsetDays <= 0) {
    return workouts.map(w => ({ id: w.id, date: w.date, changed: false }))
  }
  return workouts.map(w => {
    const shifted = addDays(w.date, Math.floor(offsetDays))
    if (shifted > weekEnd) return { id: w.id, date: w.date, changed: false }
    return { id: w.id, date: shifted, changed: shifted !== w.date }
  })
}
