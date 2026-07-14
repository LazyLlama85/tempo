import {
  computeTempoScore,
  tempoScoreInputFromSessions,
  TEMPO_SCORE_WEIGHTS,
} from '../tempoScore'
import type { StreakRow } from '../streak'

describe('computeTempoScore', () => {
  it('weights sum to 1.0 (score is a clean 0–1000)', () => {
    const sum = Object.values(TEMPO_SCORE_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('MISSION: a consistent beginner out-scores a flaky advanced lifter', () => {
    // Beginner: 3-day goal, completes 3/3 every week for 4 weeks, 12-session streak.
    const beginner = computeTempoScore({
      dueSessions: 12,
      completedSessions: 12,
      weeksMetGoal: 4,
      currentStreak: 12,
      goalPerWeek: 3,
    })
    // Advanced: 5-day goal, only 8/20 completed, bursty, streak broken.
    const advanced = computeTempoScore({
      dueSessions: 20,
      completedSessions: 8,
      weeksMetGoal: 1,
      currentStreak: 1,
      goalPerWeek: 5,
    })
    expect(beginner.score).toBeGreaterThan(advanced.score)
    expect(beginner.score).toBeGreaterThan(850) // near the top
    expect(advanced.score).toBeLessThan(450)
  })

  it('is bounded 0–1000', () => {
    const zero = computeTempoScore({ dueSessions: 0, completedSessions: 0, weeksMetGoal: 0, currentStreak: 0, goalPerWeek: 3 })
    expect(zero.score).toBe(0)
    const maxed = computeTempoScore({ dueSessions: 30, completedSessions: 30, weeksMetGoal: 4, currentStreak: 100, goalPerWeek: 3 })
    expect(maxed.score).toBeLessThanOrEqual(1000)
    expect(maxed.score).toBeGreaterThan(950)
  })

  it('cannot be gamed by over-scheduling workouts you do not complete', () => {
    // Same completed work; one person padded their schedule with skips/misses.
    const honest = computeTempoScore({ dueSessions: 12, completedSessions: 12, weeksMetGoal: 4, currentStreak: 12, goalPerWeek: 3 })
    const padder = computeTempoScore({ dueSessions: 40, completedSessions: 12, weeksMetGoal: 4, currentStreak: 12, goalPerWeek: 3 })
    expect(padder.score).toBeLessThan(honest.score) // completion term punishes the padding
  })

  it('completion component = completed ÷ due', () => {
    const r = computeTempoScore({ dueSessions: 10, completedSessions: 7, weeksMetGoal: 2, currentStreak: 3, goalPerWeek: 4 })
    expect(r.components.completion).toBeCloseTo(0.7, 6)
  })
})

describe('tempoScoreInputFromSessions', () => {
  const today = '2026-07-14'
  const mk = (planned_date: string, status: string): StreakRow => ({ planned_date, status })

  it('counts only DUE sessions for completion; future scheduled do not penalise', () => {
    const sessions: StreakRow[] = [
      mk('2026-07-13', 'completed'),
      mk('2026-07-11', 'completed'),
      mk('2026-07-09', 'missed'),
      mk('2026-07-20', 'scheduled'), // future — must be ignored
    ]
    const input = tempoScoreInputFromSessions(sessions, 3, today)
    expect(input.dueSessions).toBe(3) // 2 completed + 1 missed; future scheduled excluded
    expect(input.completedSessions).toBe(2)
  })

  it('ignores sessions outside the 28-day window', () => {
    const sessions: StreakRow[] = [
      mk('2026-07-13', 'completed'),
      mk('2026-05-01', 'completed'), // >28 days ago
    ]
    const input = tempoScoreInputFromSessions(sessions, 3, today)
    expect(input.dueSessions).toBe(1)
    expect(input.completedSessions).toBe(1)
  })

  it('a perfect 4-week beginner derives a top-tier score', () => {
    // 3 completed sessions per week for 4 weeks, no misses.
    const sessions: StreakRow[] = []
    for (let w = 0; w < 4; w++) {
      // 3 completed per rolling week: 1/3/5, 8/10/12, 15/17/19, 22/24/26 days ago.
      sessions.push(mk(offset(today, -(w * 7 + 1)), 'completed'))
      sessions.push(mk(offset(today, -(w * 7 + 3)), 'completed'))
      sessions.push(mk(offset(today, -(w * 7 + 5)), 'completed'))
    }
    const input = tempoScoreInputFromSessions(sessions, 3, today)
    expect(input.weeksMetGoal).toBe(4)
    expect(computeTempoScore(input).score).toBeGreaterThan(800)
  })
})

function offset(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}
