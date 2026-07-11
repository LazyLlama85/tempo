import { sessionStreak, longestSessionStreak, type StreakRow } from '@/lib/streak'

const row = (planned_date: string, status: string): StreakRow => ({ planned_date, status })

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

  it('a deliberately skipped session also breaks it', () => {
    const rows = [
      row('2026-07-09', 'completed'),
      row('2026-07-10', 'skipped'),
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(0)
  })

  it('pending/future rows never count and never break', () => {
    const rows = [
      row('2026-07-10', 'completed'),
      row('2026-07-11', 'scheduled'), // future, not yet done
      row('2026-07-10', 'scheduled'), // today, still pending
    ]
    expect(sessionStreak(rows, '2026-07-10')).toBe(1)
  })

  it('a day holding both a completion and a miss nets the win before the break', () => {
    const rows = [
      row('2026-07-08', 'completed'),
      row('2026-07-09', 'completed'),
      row('2026-07-10', 'completed'),
      row('2026-07-10', 'missed'),
    ]
    // The completed session on the shared day is counted (→ 1) before the same
    // day's miss ends the run — never 0, never past the break.
    expect(sessionStreak(rows, '2026-07-10')).toBe(1)
  })

  it('empty history is a zero streak', () => {
    expect(sessionStreak([], '2026-07-10')).toBe(0)
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
