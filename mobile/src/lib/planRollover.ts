// Tempo — plan-rollover kernel (the anti-"4-week cliff" math).
//
// The original launch-blocking bug: a generated 4-week plan simply ran out with no
// regeneration, leaving a paying user with an empty schedule. `extendActivePlan`
// (generatePlan.ts) fixed it with an app-open rollover check, but the actual
// decision logic — "is the plan about to run dry?" and "how many weeks do we
// generate to refill it?" — was inline and untested. It lives here now as pure,
// deterministic functions so that exact regression is locked by unit tests, and
// `extendActivePlan` calls these rather than re-deriving them.

import { BLOCK_WEEKS } from '@/lib/periodization'

// How much scheduled runway must remain before we materialize the next block. If
// the plan's last session is within this many days (or already past), we roll over.
export const PLAN_RUNWAY_DAYS = 7

// Local-date 'YYYY-MM-DD' (matches how scheduled_workouts.planned_date is stored —
// a local calendar day, never UTC-shifted). The single implementation; generatePlan
// delegates its `formatDate` here so the two can never drift apart.
export function formatLocalDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// True when the plan's last scheduled session (`lastPlannedDate`) is close enough
// to now that we should generate the next block. `today` should be midnight-local.
export function planNeedsExtension(
  lastPlannedDate: string,
  today: Date,
  runwayDays: number = PLAN_RUNWAY_DAYS,
): boolean {
  const runwayEnd = new Date(today)
  runwayEnd.setHours(0, 0, 0, 0)
  runwayEnd.setDate(runwayEnd.getDate() + runwayDays)
  return lastPlannedDate <= formatLocalDate(runwayEnd)
}

// How many weeks the rollover generates, and from which week index. `weekFrom`
// continues the week_index count (so indices never duplicate or reset); `weekCount`
// is at least one full block, and enough extra to cover a long absence and still
// land a fresh block ahead of today. Keeping the count ≥ BLOCK_WEEKS is what
// guarantees the horizon can never come back short — the cliff can't reopen.
export function planExtensionWeeks(args: {
  lastWeek: number
  weeksSinceStart: number
  blockWeeks?: number
}): { weekFrom: number; weekCount: number } {
  const blockWeeks = args.blockWeeks ?? BLOCK_WEEKS
  const weekFrom = args.lastWeek + 1
  const weekCount = Math.max(blockWeeks, args.weeksSinceStart + blockWeeks - weekFrom + 1)
  return { weekFrom, weekCount }
}
