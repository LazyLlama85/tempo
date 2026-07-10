// Tempo — the streak, defined so Tempo's own users can actually build one.
//
// A streak counts CONSECUTIVE COMPLETED SESSIONS, not calendar days. A Mon/Wed/Fri
// plan followed perfectly is a growing streak — rest days between sessions never
// break it (the app schedules those rest days on purpose). What breaks it is a
// settled failure: a session marked missed or deliberately skipped.
//
// Rows that are still 'scheduled' are pending (today's not-yet-done workout, a
// future session) or opportunistic one-offs the missed-workout sweep deliberately
// never fails — neither should count against the streak. 'rescheduled' rows are
// superseded duplicates and are ignored everywhere.

export interface StreakRow {
  planned_date: string // 'YYYY-MM-DD'
  status: string
}

export function sessionStreak(rows: StreakRow[], todayStr: string): number {
  const settled = rows.filter(r =>
    r.planned_date <= todayStr &&
    (r.status === 'completed' || r.status === 'missed' || r.status === 'skipped'),
  )

  // Walk most-recent-first. On a day holding both a completed session and a miss,
  // count the win before hitting the break, so the day nets its completed work.
  const rank = (r: StreakRow) => (r.status === 'completed' ? 0 : 1)
  settled.sort((a, b) => b.planned_date.localeCompare(a.planned_date) || rank(a) - rank(b))

  let streak = 0
  for (const r of settled) {
    if (r.status === 'completed') streak++
    else break
  }
  return streak
}

// Longest consecutive-completed run in the given window (same session-based
// definition as sessionStreak). Used for friend profiles ("longest streak").
export function longestSessionStreak(rows: StreakRow[], todayStr: string): number {
  const settled = rows.filter(r =>
    r.planned_date <= todayStr &&
    (r.status === 'completed' || r.status === 'missed' || r.status === 'skipped'),
  )
  const rank = (r: StreakRow) => (r.status === 'completed' ? 0 : 1)
  settled.sort((a, b) => a.planned_date.localeCompare(b.planned_date) || rank(a) - rank(b))

  let best = 0
  let run = 0
  for (const r of settled) {
    if (r.status === 'completed') { run++; best = Math.max(best, run) }
    else run = 0
  }
  return best
}
