import {
  computeMomentum,
  readinessFromHistory,
  optimalWindow,
  workoutForecast,
  consistencyPredictor,
  successPatterns,
  consistencyHeatmap,
  frequencySeries,
  muscleBalance,
  journeyTimeline,
} from '../fitnessInsights'
import type { StreakRow } from '../streak'

const TODAY = '2026-07-14'
function d(off: number): string {
  const t = new Date('2026-07-14T00:00:00')
  t.setDate(t.getDate() + off)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
const s = (planned_date: string, status: string): StreakRow => ({ planned_date, status })

describe('computeMomentum', () => {
  it('rewards a live streak and flags a personal best', () => {
    const sessions = [0, -1, -2, -3, -4, -5].map((o) => s(d(o), 'completed'))
    const m = computeMomentum(sessions, 3, TODAY)
    expect(m.currentStreak).toBe(6)
    expect(m.isBest).toBe(true)
    expect(m.score).toBeGreaterThan(30)
    expect(m.message).toMatch(/longest streak/i)
  })
  it('gives an empty history a restart message, not a crash', () => {
    const m = computeMomentum([], 3, TODAY)
    expect(m.score).toBe(0)
    expect(m.currentStreak).toBe(0)
    expect(m.message).toMatch(/restart|good day/i)
  })
})

describe('readinessFromHistory', () => {
  it('scores an optimally-rested lifter high', () => {
    const now = new Date(`${TODAY}T18:00:00`)
    const sessions = [s(d(-1), 'completed')]
    const r = readinessFromHistory(sessions, [`${d(-1)}T12:00:00`], now)
    expect(r.score).toBeGreaterThanOrEqual(80)
    expect(r.recovery.tone).toBe('good')
    expect(r.recovery.detail).toMatch(/rested/i)
  })
  it('penalises training again within a few hours', () => {
    const now = new Date(`${TODAY}T18:00:00`)
    const r = readinessFromHistory([s(TODAY, 'completed')], [`${TODAY}T14:00:00`], now)
    expect(r.recovery.tone).toBe('low')
    expect(r.score).toBeLessThan(80)
  })
})

describe('optimalWindow', () => {
  it('needs data before claiming a window', () => {
    expect(optimalWindow([`${d(-1)}T17:00:00`]).hasData).toBe(false)
  })
  it('finds an evening window from repeated PM sessions', () => {
    const times = [-1, -3, -5, -7, -9, -11].map((o) => `${d(o)}T17:00:00`)
    const w = optimalWindow(times)
    expect(w.hasData).toBe(true)
    expect(w.windowLabel).toMatch(/PM/)
  })
})

describe('workoutForecast', () => {
  it('flags a third consecutive day as fatigue risk', () => {
    const sessions = [s(TODAY, 'completed'), s(d(1), 'scheduled'), s(d(2), 'scheduled'), s(d(3), 'scheduled')]
    const f = workoutForecast(sessions, TODAY, 3)
    expect(f[0].level).toBe('moderate') // tomorrow = 2nd in a row
    expect(f[1].level).toBe('risk') // 3rd in a row
  })
})

describe('consistencyPredictor', () => {
  it('celebrates a met goal', () => {
    const sessions = [0, 0, 0].map(() => s(TODAY, 'completed'))
    const p = consistencyPredictor(sessions, 3, TODAY)
    expect(p.completed).toBe(3)
    expect(p.onTrack).toBe(true)
    expect(p.message).toMatch(/goal hit/i)
  })
  it('tells an idle week what it needs', () => {
    const p = consistencyPredictor([], 3, TODAY)
    expect(p.onTrack).toBe(false)
    expect(p.message).toMatch(/schedule/i)
  })
})

describe('successPatterns', () => {
  it('surfaces a real time-of-day pattern', () => {
    const times = Array.from({ length: 8 }, (_, i) => `${d(-i)}T17:00:00`)
    const out = successPatterns([], times, TODAY)
    expect(out.some((p) => /before 7 PM/.test(p))).toBe(true)
  })
})

describe('consistencyHeatmap', () => {
  it('lays out weeks×7 and counts completions', () => {
    const sessions = [s(TODAY, 'completed'), s(d(-3), 'completed'), s(d(-7), 'missed')]
    const h = consistencyHeatmap(sessions, TODAY, 4)
    expect(h.weeks).toHaveLength(4)
    expect(h.weeks.every((w) => w.length === 7)).toBe(true)
    expect(h.totalCompleted).toBe(2)
  })
})

describe('frequencySeries', () => {
  it('averages completed workouts per week', () => {
    const sessions = [0, -7, -14, -21].map((o) => s(d(o), 'completed'))
    const f = frequencySeries(sessions, TODAY, '1M')
    expect(f.points).toHaveLength(4)
    expect(f.avgPerWeek).toBeCloseTo(1, 5)
  })
})

describe('muscleBalance', () => {
  it('spots an untrained group', () => {
    const sets = [
      ...Array(4).fill({ group: 'chest' }),
      ...Array(4).fill({ group: 'back' }),
      ...Array(2).fill({ group: 'shoulders' }),
      ...Array(2).fill({ group: 'arms' }),
      ...Array(2).fill({ group: 'legs' }),
    ]
    const mb = muscleBalance(sets)
    expect(mb.slices.reduce((a, b) => a + b.sets, 0)).toBe(14)
    expect(mb.insight).toMatch(/core/i)
  })
})

describe('journeyTimeline', () => {
  it('opens with the first workout and marks milestones', () => {
    const sessions = Array.from({ length: 12 }, (_, i) => s(d(-30 + i), 'completed'))
    const t = journeyTimeline(sessions, TODAY)
    expect(t.some((e) => /started/i.test(e.title))).toBe(true)
    expect(t.some((e) => /10 workouts/i.test(e.title))).toBe(true)
  })
})
