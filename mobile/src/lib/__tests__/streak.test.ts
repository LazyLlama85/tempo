import { sessionStreak, longestSessionStreak, distinctDayStreak, type StreakRow } from '@/lib/streak'

const row = (planned_date: string, status: string, source?: string, actual_duration_min?: number | null): StreakRow =>
  ({ planned_date, status, source, actual_duration_min })

describe('streak — consecutive completed sessions (not calendar days)', () => {
  it('rest days between sessions never break the streak', () => {
    // A Mon/Wed/Fri plan followed perfectly — the gaps are scheduled rest days.
    const rows = [
      row('2026-07-06', 'completed'), // Mon
      row('2026-07-08', 'completed'), // Wed
      row('2026-07-10', 'completed'), // Fri
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(3)
  })

  it('a missed session breaks it', () => {
    const rows = [
      row('2026-07-08', 'completed'),
      row('2026-07-09', 'missed'),
      row('2026-07-10', 'completed'),
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(1) // only Fri counts; Wed miss breaks the run
  })

  it('a past deliberately-skipped session breaks it', () => {
    const rows = [
      row('2026-07-08', 'completed'),
      row('2026-07-09', 'skipped'),
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(0)
  })

  it("TODAY's own skip/miss does NOT break the streak yet — there's still time left in the day", () => {
    const rows = [
      row('2026-07-09', 'completed'),
      row('2026-07-10', 'skipped'), // e.g. swapped to a Quick Workout, not finished yet
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(1) // yesterday's completion still stands
  })

  it("TODAY's own miss doesn't mask a real PAST break further back", () => {
    const rows = [
      row('2026-07-08', 'missed'),   // a real, settled break
      row('2026-07-09', 'completed'),
      row('2026-07-10', 'skipped'),  // today, still undecided
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(1) // only the 07-09 completion counts
  })

  it('pending/future rows never count and never break', () => {
    const rows = [
      row('2026-07-10', 'completed'),
      row('2026-07-11', 'scheduled'), // future, not yet done
      row('2026-07-10', 'scheduled'), // today, still pending
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(1)
  })

  it('a day you trained is NOT broken by another missed session that same day', () => {
    const rows = [
      row('2026-07-08', 'completed'),
      row('2026-07-09', 'completed'),
      row('2026-07-10', 'completed'),
      row('2026-07-10', 'missed'), // e.g. the plan slot you replaced with a different workout
    ]
    // You completed a session every day → the same-day miss doesn't reset it.
    expect(sessionStreak(rows, '2026-07-10')).toBe(3)
  })

  it('opportunistic quick workouts (skipped/missed) never break the streak', () => {
    const rows = [
      row('2026-07-13', 'completed', 'split'),
      row('2026-07-14', 'completed', 'split'),
      row('2026-07-14', 'skipped', 'quick'),   // added + abandoned → ignored
      row('2026-07-15', 'skipped', 'quick'),    // today: only a skipped quick workout
    ]
    // The quick skips are ignored; the real completions still form a 2-session streak.
    expect(sessionStreak(rows, '2026-07-15')).toBe(2)
    expect(longestSessionStreak(rows, '2026-07-15')).toBe(2)
  })

  it('a committed (plan) skip with no completion breaks it — once that day has passed', () => {
    const rows = [
      row('2026-07-09', 'completed', 'split'),
      row('2026-07-10', 'skipped', 'plan'), // committed plan session skipped, nothing else done
    ]
    // Evaluated the NEXT day: 07-10 is now a settled, past break.
    expect(sessionStreak(rows, '2026-07-11')).toBe(0)
  })

  it('empty history is a zero streak', () => {
    expect(sessionStreak([], '2026-07-10')).toBe(0)
  })

  it('a completed session under 5 minutes does not advance the streak', () => {
    const rows = [
      row('2026-07-09', 'completed'),
      row('2026-07-10', 'completed', undefined, 3), // backed out after 3 minutes
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(1) // only 07-09 counts
  })

  it('a too-short session is ignored, not treated as a break', () => {
    const rows = [
      row('2026-07-08', 'completed'),
      row('2026-07-09', 'completed', undefined, 2), // too short — ignored, not a break
      row('2026-07-10', 'completed'),
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(2) // 07-08 + 07-10, the short one just doesn't add
  })

  it('a completed session with no actual_duration_min recorded still counts (older rows / callers that omit it)', () => {
    const rows = [row('2026-07-10', 'completed', undefined, null), row('2026-07-09', 'completed')]
    expect(sessionStreak(rows, '2026-07-10')).toBe(2)
  })

  it('exactly 5 minutes meets the bar', () => {
    expect(sessionStreak([row('2026-07-10', 'completed', undefined, 5)], '2026-07-10')).toBe(1)
  })

  it('distinctDayStreak counts each trained day once, even with two sessions that day', () => {
    const rows = [
      row('2026-07-08', 'completed'),
      row('2026-07-09', 'completed'),
      row('2026-07-09', 'completed'), // a same-day second session — must not add a second day
      row('2026-07-10', 'completed'),
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(4) // the session-count metric DOES count it twice
    expect(distinctDayStreak(rows, '2026-07-10')).toBe(3) // the honest day-count does not
  })

  it('longestSessionStreak finds the best completed run in the window', () => {
    const rows = [
      row('2026-07-01', 'completed'),
      row('2026-07-02', 'completed'),
      row('2026-07-03', 'missed'),
      row('2026-07-04', 'completed'),
      row('2026-07-05', 'completed'),
      row('2026-07-06', 'completed'),
      row('2026-07-07', 'scheduled'), // ignored
    ]
    expect(longestSessionStreak(rows, '2026-07-10')).toBe(3)
  })
})
