// Tempo — the streak, defined so Tempo's own users can actually build one.
//
// A streak counts COMPLETED SESSIONS across consecutive TRAINING days, not calendar
// days. A Mon/Wed/Fri plan followed perfectly is a growing streak — rest days between
// sessions never break it (the app schedules those rest days on purpose).
//
// What breaks it: a PAST day where a COMMITTED session (plan / split / custom) was
// missed or deliberately skipped AND nothing was completed. Three things
// deliberately DON'T break it:
//   • A day you trained. If you completed a session that day, the day counts — even
//     if some other session on the same day was missed/skipped (e.g. the plan slot
//     you replaced with a different workout).
//   • Opportunistic QUICK workouts you added and didn't finish. Those were never a
//     scheduled commitment, so a skipped/missed `source:'quick'` row is ignored
//     entirely — it neither counts nor breaks the streak.
//   • TODAY's own miss/skip. There's still time left in today — e.g. swapping
//     today's session for a Quick Workout marks the original row 'skipped'
//     immediately, well before the replacement is even started. Only a day that has
//     actually finished can be a settled break; today is judged tomorrow.
//
// 'scheduled'/'rescheduled' rows are pending or superseded and are ignored everywhere.

export interface StreakRow {
  planned_date: string // 'YYYY-MM-DD'
  status: string
  /** Where the workout came from. Opportunistic `quick` sessions never break the streak. */
  source?: string | null
}

// A missed/skipped session breaks the streak only if it was a committed session
// (anything that isn't an opportunistic quick workout).
function isCommittedMiss(r: StreakRow): boolean {
  return (r.status === 'missed' || r.status === 'skipped') && r.source !== 'quick'
}

// TODAY's own miss/skip never breaks the streak — there's still time left in the
// day (e.g. swapping today's session for a Quick Workout marks the original
// 'skipped' immediately, before the replacement is even started; the streak
// shouldn't zero out mid-swap). Only a PAST day's committed miss is a real,
// settled break. `day`/`todayStr` are both 'YYYY-MM-DD', so string comparison is
// exact and cheap.
function isSettledBreak(day: string, todayStr: string, broken: boolean): boolean {
  return broken && day < todayStr
}

// Summarize each day up to `todayStr`: how many completed, and whether a committed
// session was missed there. Quick skips/misses, scheduled and rescheduled are ignored.
function summarizeDays(rows: StreakRow[], todayStr: string): Map<string, { completed: number; broken: boolean }> {
  const byDay = new Map<string, { completed: number; broken: boolean }>()
  const bump = (date: string) => {
    let e = byDay.get(date)
    if (!e) { e = { completed: 0, broken: false }; byDay.set(date, e) }
    return e
  }
  for (const r of rows) {
    if (r.planned_date > todayStr) continue
    if (r.status === 'completed') bump(r.planned_date).completed++
    else if (isCommittedMiss(r)) bump(r.planned_date).broken = true
  }
  return byDay
}

export function sessionStreak(rows: StreakRow[], todayStr: string): number {
  const byDay = summarizeDays(rows, todayStr)
  const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a)) // most-recent first
  let streak = 0
  for (const day of days) {
    const e = byDay.get(day)!
    if (e.completed > 0) streak += e.completed             // trained that day → the day counts
    else if (isSettledBreak(day, todayStr, e.broken)) break // a past day's committed miss → stop
  }
  return streak
}

// Longest completed run in the window (same day-aware definition as sessionStreak).
export function longestSessionStreak(rows: StreakRow[], todayStr: string): number {
  const byDay = summarizeDays(rows, todayStr)
  const days = [...byDay.keys()].sort((a, b) => a.localeCompare(b)) // oldest first
  let best = 0
  let run = 0
  for (const day of days) {
    const e = byDay.get(day)!
    if (e.completed > 0) { run += e.completed; best = Math.max(best, run) }
    else if (isSettledBreak(day, todayStr, e.broken)) run = 0
  }
  return best
}
