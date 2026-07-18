import {
  computeMomentum,
  readinessFromHistory,
  optimalWindow,
  consistencyPredictor,
  successPatterns,
  consistencyHeatmap,
  frequencySeries,
  muscleBalance,
  strengthTrends,
  intensityFromReadiness,
  muscleRecovery,
  muscleIntelligence,
  fineMuscleIntelligence,
  bodyMuscleOf,
  muscleRank,
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
    const sessions = [s(d(-2), 'completed')]
    const r = readinessFromHistory(sessions, [`${d(-2)}T18:00:00`], now) // ~48h rest
    expect(r.score).toBeGreaterThanOrEqual(80)
    expect(r.recovery.tone).toBe('good')
    expect(r.recovery.detail).toMatch(/rested/i)
  })
  it('does NOT max out just a day after training', () => {
    const now = new Date(`${TODAY}T18:00:00`)
    const r = readinessFromHistory([s(d(-1), 'completed')], [`${d(-1)}T12:00:00`], now) // ~30h
    expect(r.score).toBeLessThan(90) // was incorrectly hitting ~100
    expect(r.recovery.label).toBe('Recovering')
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

describe('strengthTrends', () => {
  it('reports gains and ignores flat / single-day lifts', () => {
    const sets = [
      { id: 'bench', name: 'Bench Press', weight: 100, at: `${d(-30)}T17:00:00` },
      { id: 'bench', name: 'Bench Press', weight: 120, at: `${d(-2)}T17:00:00` },
      { id: 'squat', name: 'Back Squat', weight: 200, at: `${d(-30)}T17:00:00` },
      { id: 'squat', name: 'Back Squat', weight: 200, at: `${d(-2)}T17:00:00` },
      { id: 'ohp', name: 'Overhead Press', weight: 80, at: `${d(-3)}T17:00:00` },
    ]
    const t = strengthTrends(sets)
    const bench = t.find((x) => x.id === 'bench')
    expect(bench).toBeTruthy()
    expect(bench!.pct).toBeCloseTo(20, 1)
    expect(t.find((x) => x.id === 'squat')).toBeUndefined() // no gain
    expect(t.find((x) => x.id === 'ohp')).toBeUndefined() // single day
  })
})

describe('intensityFromReadiness', () => {
  it('maps a readiness score to a training intensity', () => {
    expect(intensityFromReadiness(85).label).toBe('Hard')
    expect(intensityFromReadiness(60).label).toBe('Moderate')
    expect(intensityFromReadiness(30).label).toBe('Easy')
  })
})

describe('muscleRecovery', () => {
  it('classifies per-muscle recovery and recommends a focus', () => {
    const now = new Date(`${TODAY}T18:00:00`)
    const sets = [
      { group: 'chest', at: `${d(-3)}T10:00:00` }, // ~3 days → recovered
      { group: 'legs', at: `${TODAY}T09:00:00` },  // ~9h → fatigued
    ]
    const mr = muscleRecovery(sets, now)
    expect(mr.groups).toHaveLength(5)
    expect(mr.groups.find((g) => g.group === 'chest')!.status).toBe('recovered')
    expect(mr.groups.find((g) => g.group === 'legs')!.status).toBe('fatigued')
    expect(mr.groups.find((g) => g.group === 'back')!.status).toBe('untrained')
    expect(typeof mr.recommendedFocus).toBe('string')
  })
})

describe('muscleIntelligence', () => {
  it('derives per-group status + a balance score from real set data', () => {
    const now = new Date(`${TODAY}T18:00:00`)
    const sets = [
      ...Array(6).fill(0).map(() => ({ group: 'chest', at: `${TODAY}T09:00:00` })), // today → fatigued
      ...Array(6).fill(0).map(() => ({ group: 'legs', at: `${d(-3)}T09:00:00` })),  // 3 days ago → recovered
    ]
    const mi = muscleIntelligence(sets, now)
    expect(mi.hasData).toBe(true)
    expect(mi.groups).toHaveLength(6)
    expect(mi.groups.find((g) => g.group === 'chest')!.status).toBe('fatigued')
    expect(mi.groups.find((g) => g.group === 'legs')!.status).toBe('optimal')
    expect(mi.groups.find((g) => g.group === 'back')!.status).toBe('attention') // never trained
    expect(mi.overallBalance).toBeGreaterThanOrEqual(0)
    expect(mi.overallBalance).toBeLessThanOrEqual(100)
  })
  it('reports no data for an empty history', () => {
    expect(muscleIntelligence([]).hasData).toBe(false)
  })
})

describe('fineMuscleIntelligence', () => {
  it('maps stored primary_muscles to body regions with independent recovery', () => {
    const now = new Date(`${TODAY}T18:00:00`)
    const sets = [
      { muscles: ['biceps'], at: `${TODAY}T09:00:00` },   // today → fatigued, low recovery
      { muscles: ['triceps'], at: `${d(-3)}T09:00:00` },  // 3 days ago → optimal, 100%
      { muscles: ['quads', 'glutes'], at: `${d(-1)}T09:00:00` }, // ~1 day → both credited
    ]
    const res = fineMuscleIntelligence(sets, now)
    expect(res.hasData).toBe(true)
    const biceps = res.muscles.find((m) => m.muscle === 'biceps')!
    const triceps = res.muscles.find((m) => m.muscle === 'triceps')!
    // Biceps and triceps are tracked SEPARATELY (the whole point of the upgrade).
    expect(biceps.status).toBe('fatigued')
    expect(triceps.status).toBe('optimal')
    expect(triceps.recoveryPct).toBe(100)
    expect(biceps.recoveryPct).toBeLessThan(triceps.recoveryPct)
    // 'quads' → quadriceps, 'glutes' → gluteal (aliases resolved).
    expect(res.muscles.some((m) => m.muscle === 'quadriceps')).toBe(true)
    expect(res.muscles.some((m) => m.muscle === 'gluteal')).toBe(true)
    // Sorted least-recovered first.
    expect(res.muscles[0].recoveryPct).toBeLessThanOrEqual(res.muscles[res.muscles.length - 1].recoveryPct)
  })
  it('resolves aliases and ignores unmapped/too-coarse names', () => {
    expect(bodyMuscleOf('lats')).toBe('upper-back')
    expect(bodyMuscleOf('Glutes')).toBe('gluteal')
    expect(bodyMuscleOf('full_body')).toBeNull()
    expect(fineMuscleIntelligence([]).hasData).toBe(false)
  })
})

describe('muscleRank', () => {
  it('tiers muscles by cumulative volume and finds most/least trained', () => {
    const sets = [
      ...Array(120).fill(0).map(() => ({ group: 'chest' })), // advanced
      ...Array(5).fill(0).map(() => ({ group: 'legs' })),    // beginner
    ]
    const mr = muscleRank(sets)
    expect(mr.hasData).toBe(true)
    expect(mr.groups).toHaveLength(6)
    expect(mr.groups.find((g) => g.group === 'chest')!.tier).toBe('advanced')
    expect(mr.groups.find((g) => g.group === 'legs')!.tier).toBe('beginner')
    expect(mr.mostTrained).toBe('chest')
    expect(mr.leastTrained).toBe('legs')
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
