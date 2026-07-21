import { badgeStatsFromSessions, computeEarnedBadges, BADGES, getSeenBadges, markBadgesSeen, hasSeenRecord } from '../badges'
import type { StreakRow } from '../streak'

// jest's testEnvironment is 'node' — no real localStorage global. A minimal
// in-memory stand-in, matching the Storage interface badges.ts reads via
// `globalThis.localStorage` (same pattern as feedLog.test.ts).
function installFakeLocalStorage() {
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
}

const today = '2026-07-14' // Tuesday; ISO Monday = 2026-07-13
const mk = (planned_date: string, status: string): StreakRow => ({ planned_date, status })
const offset = (d: string, days: number) =>
  new Date(new Date(`${d}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)

const earnedKeys = (sessions: StreakRow[], goal = 3, stored: string[] = []) =>
  computeEarnedBadges(badgeStatsFromSessions(sessions, goal, today), new Set(stored))

describe('badges — derived consistency', () => {
  it('all catalog keys are unique and the 6 spec badges exist', () => {
    const keys = BADGES.map((b) => b.key)
    expect(new Set(keys).size).toBe(keys.length)
    ;['perfect_week', 'consistency_champion', 'streak_30', 'weekly_winner', 'top3_monthly', 'workout_partner'].forEach(
      (k) => expect(keys).toContain(k),
    )
  })

  it('Perfect Week: a week with all due sessions completed earns it', () => {
    const sessions = [mk('2026-07-13', 'completed'), mk('2026-07-14', 'completed')] // this week, no misses
    expect(earnedKeys(sessions)).toContain('perfect_week')
  })

  it('a week with a miss is NOT perfect', () => {
    const sessions = [mk('2026-07-13', 'completed'), mk('2026-07-14', 'missed')]
    expect(earnedKeys(sessions).has('perfect_week')).toBe(false)
  })

  it('30-Day Streak: 30 completed in a row earns it', () => {
    const sessions: StreakRow[] = []
    for (let i = 0; i < 30; i++) sessions.push(mk(offset(today, -i), 'completed'))
    expect(earnedKeys(sessions)).toContain('streak_30')
  })

  it('Consistency Champion: 4 consecutive full weeks hitting a 3-day goal', () => {
    // Place 3 completions in each of the last 4 FULL ISO weeks (Monday = 2026-07-13).
    const monday = '2026-07-13'
    const sessions: StreakRow[] = []
    for (let w = 1; w <= 4; w++) {
      const start = offset(monday, -w * 7)
      sessions.push(mk(start, 'completed'))
      sessions.push(mk(offset(start, 2), 'completed'))
      sessions.push(mk(offset(start, 4), 'completed'))
    }
    const stats = badgeStatsFromSessions(sessions, 3, today)
    expect(stats.weeksMetGoalRun).toBeGreaterThanOrEqual(4)
    expect(computeEarnedBadges(stats, new Set()).has('consistency_champion')).toBe(true)
  })

  it('a fresh account earns nothing', () => {
    expect(earnedKeys([]).size).toBe(0)
  })

  it('milestone badges use the passed-in all-time totals (workouts + volume)', () => {
    const stats = badgeStatsFromSessions([mk('2026-07-13', 'completed')], 3, today, {
      totalWorkouts: 100,
      totalVolume: 100000,
    })
    const earned = computeEarnedBadges(stats, new Set())
    for (const k of ['first_workout', 'thirty_sessions', 'century', 'ton_club', 'iron_tonne']) {
      expect(earned.has(k)).toBe(true)
    }
  })
})

describe('badges — competitive (stored)', () => {
  it('competitive badges come only from stored keys, never derived', () => {
    const none = earnedKeys([mk('2026-07-13', 'completed')])
    expect(none.has('weekly_winner')).toBe(false)
    const withStored = earnedKeys([mk('2026-07-13', 'completed')], 3, ['weekly_winner', 'top3_monthly'])
    expect(withStored.has('weekly_winner')).toBe(true)
    expect(withStored.has('top3_monthly')).toBe(true)
  })
})

// Achievement-unlock celebration (§26, L24) reads this exact "seen" record to
// distinguish a genuinely new unlock from one the user already has — these
// lock in the distinction its bootstrap safety depends on.
describe('badges — seen record (unlock-celebration bootstrap)', () => {
  beforeEach(() => installFakeLocalStorage())

  it('has no record for a brand-new user', () => {
    expect(hasSeenRecord('u1')).toBe(false)
    expect(getSeenBadges('u1')).toEqual(new Set())
  })

  it('marking badges seen creates a record and is queryable', () => {
    markBadgesSeen('u1', ['thirty_sessions', 'ton_club'])
    expect(hasSeenRecord('u1')).toBe(true)
    expect(getSeenBadges('u1')).toEqual(new Set(['thirty_sessions', 'ton_club']))
  })

  it('marking seen merges with (never replaces) whatever was already recorded', () => {
    markBadgesSeen('u1', ['thirty_sessions'])
    markBadgesSeen('u1', ['ton_club'])
    expect(getSeenBadges('u1')).toEqual(new Set(['thirty_sessions', 'ton_club']))
  })

  it('marking seen with an empty set still creates a (now-distinguishable) record', () => {
    markBadgesSeen('u1', [])
    expect(hasSeenRecord('u1')).toBe(true)
    expect(getSeenBadges('u1').size).toBe(0)
  })

  it('records are per-user', () => {
    markBadgesSeen('u1', ['century'])
    expect(hasSeenRecord('u2')).toBe(false)
    expect(getSeenBadges('u2').size).toBe(0)
  })
})
