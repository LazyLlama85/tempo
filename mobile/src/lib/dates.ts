// Tempo — shared local-date utilities (MASTER_FIX_PLAN.md C1).
//
// ~15 modules each re-implemented their own "today as a local YYYY-MM-DD
// string" / date-diff logic, which is the structural root cause of the
// streak/missed-workout timezone fragility named elsewhere in this codebase
// (e.g. adaptation.ts's weeksBetween used to parse dates as UTC while every
// other module built local dates — a real bug, not just duplication). This
// is the single implementation everything should delegate to, so a future
// correctness fix only has to be made once.
//
// `scheduled_workouts.planned_date` is always a LOCAL calendar day (never
// UTC-shifted) — every function here works in local time to match.

/** 'YYYY-MM-DD' for a Date, in LOCAL time (matches how planned_date is stored). */
export function todayStr(d: Date = new Date()): string {
  return toDateStr(d)
}

/** 'YYYY-MM-DD' for a Date, in LOCAL time. */
export function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** A 'YYYY-MM-DD' string, n days later (n may be negative), still 'YYYY-MM-DD'. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

/**
 * Whole days between two 'YYYY-MM-DD' strings (b - a), both parsed as LOCAL
 * midnight. DST-safe: constructing both dates at local midnight and diffing
 * in days (not raw milliseconds / 86_400_000) means a 23- or 25-hour day
 * around a DST transition still counts as exactly one day, not a fraction.
 */
export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`)
  const db = new Date(`${b}T00:00:00`)
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}

/**
 * The last day ('YYYY-MM-DD', Saturday) of the Sunday-start calendar week
 * containing dateStr — matches the Plan tab's own week strip (`startOfWeek`
 * in `app/(tabs)/plan.tsx`, Sunday first per US calendars). Used to cap
 * "delay whole week" so a shift can never spill a workout into next week.
 */
export function weekEndStr(dateStr: string): string {
  const dow = new Date(`${dateStr}T00:00:00`).getDay() // 0=Sun … 6=Sat
  return addDays(dateStr, 6 - dow)
}

/**
 * A 'YYYY-MM-DD' date at a given minute-of-day, as a real Date — DST-safe
 * because it goes through Date's own local-time constructor (setHours),
 * which resolves wall-clock time correctly across a spring-forward/fall-back
 * boundary, instead of adding `minutes * 60_000` to a fixed epoch offset
 * (which silently shifts by an hour on a transition day).
 */
export function atMinute(dateStr: string, minutes: number): Date {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setHours(0, minutes, 0, 0)
  return d
}
