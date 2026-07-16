import {
  goalScheme, estimate1RM, estimateSessionMinutes, exerciseCountForDuration, buildPrescription,
  type SetPerformance,
} from '@/lib/progression'
import { weekProgression } from '@/lib/periodization'

describe('progression — goal scheme & duration math', () => {
  it('returns the documented scheme per goal and falls back to general fitness', () => {
    expect(goalScheme('strength')).toEqual({ sets: 4, repLow: 3, repHigh: 6, rest: 180 })
    expect(goalScheme('muscle_gain')).toEqual({ sets: 3, repLow: 8, repHigh: 12, rest: 90 })
    // Unknown goal → general_fitness, never undefined.
    expect(goalScheme('nonsense' as never)).toEqual(goalScheme('general_fitness'))
  })

  it('estimate1RM uses Epley and clamps a single rep to the weight', () => {
    expect(estimate1RM(100, 1)).toBe(100)
    expect(estimate1RM(100, 10)).toBe(133) // 100 * (1 + 10/30) = 133.3 → 133
    expect(estimate1RM(225, 5)).toBe(263) // 225 * (1 + 5/30) = 262.5 → 263
  })

  it('session length rises with exercise count and drops on a deload', () => {
    const three = estimateSessionMinutes(3, 'muscle_gain')
    const five = estimateSessionMinutes(5, 'muscle_gain')
    expect(five).toBeGreaterThan(three)
    expect(estimateSessionMinutes(5, 'muscle_gain', true)).toBeLessThan(five) // fewer sets on deload
    expect(estimateSessionMinutes(0, 'muscle_gain')).toBe(0)
    expect(estimateSessionMinutes(3, 'muscle_gain')).toBeGreaterThanOrEqual(10) // floor
  })

  it('fits fewer heavy lifts than light ones into the same window, clamped 3–7', () => {
    // Strength rests a full 3 min, so a 45-min window fits fewer lifts than a
    // short-rest fat-loss circuit does.
    expect(exerciseCountForDuration(45, 'strength'))
      .toBeLessThanOrEqual(exerciseCountForDuration(45, 'fat_loss'))
    for (const goal of ['strength', 'fat_loss', 'muscle_gain'] as const) {
      const n = exerciseCountForDuration(45, goal)
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(7)
    }
    expect(exerciseCountForDuration(0, 'muscle_gain')).toBeGreaterThanOrEqual(3) // bad input → sane default
  })
})

describe('progression — buildPrescription autoregulation', () => {
  const clean = (w: number, r: number, rpe: number | null = null): SetPerformance =>
    ({ weight_lbs: w, reps: r, rpe })

  it('first time: no weight, "new" direction', () => {
    const p = buildPrescription([], 'muscle_gain', 'h_push')
    expect(p.direction).toBe('new')
    expect(p.suggestedWeight).toBeNull()
    expect(p.lastSummary).toBeNull()
  })

  it('cleared the top of the range at low RPE → add weight (up)', () => {
    const p = buildPrescription([clean(100, 12, 7)], 'muscle_gain', 'h_push')
    expect(p.direction).toBe('up')
    expect(p.suggestedWeight).toBe(105) // +5 upper-body increment
  })

  it('lower-body compounds take a bigger jump', () => {
    const p = buildPrescription([clean(200, 12, 7)], 'muscle_gain', 'squat')
    expect(p.direction).toBe('up')
    expect(p.suggestedWeight).toBe(210) // +10 for squat/hinge
  })

  it('a grind (short reps or very high RPE) backs the load off ~10%', () => {
    const short = buildPrescription([clean(100, 5, null)], 'muscle_gain', 'h_push') // 5 < repLow 8
    expect(short.direction).toBe('down')
    expect(short.suggestedWeight).toBe(90)

    const maxedOut = buildPrescription([clean(100, 10, 9.7)], 'muscle_gain', 'h_push') // rpe ≥ 9.5
    expect(maxedOut.direction).toBe('down')
  })

  it('mid-range performance holds the weight', () => {
    const p = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push')
    expect(p.direction).toBe('hold')
    expect(p.suggestedWeight).toBe(100)
  })

  it('workout feedback nudges volume: too-easy adds a set, too-hard trims one', () => {
    const base = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0)
    const easier = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 1)
    const harder = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, -1)
    expect(easier.sets).toBe(base.sets + 1)
    expect(harder.sets).toBe(base.sets - 1)
  })

  it('low readiness trims a working set', () => {
    const normal = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false)
    const tired = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', true)
    expect(tired.sets).toBe(normal.sets - 1)
  })

  it('a deload week overrides to "down", lightens the load, and reframes the reason', () => {
    const deload = weekProgression(3, 'intermediate', 'normal') // isDeload, 0.85 intensity
    const p = buildPrescription([clean(100, 12, 7)], 'muscle_gain', 'h_push', false, 0, deload)
    expect(p.direction).toBe('down') // even though the raw call was "up"
    expect(p.reason).toBe(deload.note)
    expect(p.suggestedWeight).not.toBeNull()
    expect(p.suggestedWeight!).toBeLessThan(105) // scaled by the 0.85 deload intensity
  })

  it('always clamps working sets to a sane 2–6 range', () => {
    const peak = weekProgression(2, 'intermediate', 'normal') // +1 set
    const p = buildPrescription([clean(100, 10, 8)], 'strength', 'h_push', false, 1, peak)
    expect(p.sets).toBeGreaterThanOrEqual(2)
    expect(p.sets).toBeLessThanOrEqual(6)
  })
})

describe('progression — volume-landmark cap (B5.4)', () => {
  const clean = (w: number, r: number, rpe: number | null = null): SetPerformance =>
    ({ weight_lbs: w, reps: r, rpe })

  it('omitting weeklyVolume changes nothing — fully backward compatible', () => {
    const withArg = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0, null, null, undefined)
    const without = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0)
    expect(withArg).toEqual(without)
  })

  it('caps sets and appends an honest note when the muscle group is already near its weekly MRV', () => {
    const p = buildPrescription(
      [clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0, null, null,
      { group: 'chest', setsThisWeek: 19, experience: 'intermediate' }, // MRV 20, room = 1 -> floor wins at 2
    )
    expect(p.sets).toBe(2)
    expect(p.reason).toMatch(/protect recovery/i)
  })

  it('is a no-op when there is plenty of room left this week', () => {
    const capped = buildPrescription(
      [clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0, null, null,
      { group: 'chest', setsThisWeek: 2, experience: 'intermediate' },
    )
    const uncapped = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0)
    expect(capped).toEqual(uncapped)
  })

  it('ignores an unrecognized/cardio/null muscle group rather than throwing', () => {
    const p = buildPrescription(
      [clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0, null, null,
      { group: 'cardio', setsThisWeek: 999, experience: 'intermediate' },
    )
    const without = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0)
    expect(p).toEqual(without)
  })

  it('a deload week is already at the sane 2-set floor, so the volume cap correctly has nothing left to trim', () => {
    const deload = weekProgression(3, 'intermediate', 'normal') // isDeload -> sets already clamped to 2
    const p = buildPrescription(
      [clean(100, 12, 7)], 'muscle_gain', 'h_push', false, 0, deload, null,
      { group: 'chest', setsThisWeek: 19, experience: 'intermediate' }, // would cap a normal week to 2 as well
    )
    expect(p.direction).toBe('down')
    expect(p.sets).toBe(2)
    // No volume note: the cap and the deload's own floor coincide at 2, so nothing
    // actually changed — `capped` correctly reports false rather than a fake note.
    expect(p.reason).toBe(deload.note)
  })

  it('the cap DOES apply on a non-deload week that would otherwise sit above the floor', () => {
    const build = weekProgression(1, 'intermediate', 'normal') // 'build' phase, no volume delta
    const p = buildPrescription(
      [clean(100, 12, 7)], 'muscle_gain', 'h_push', false, 0, build, null,
      { group: 'chest', setsThisWeek: 19, experience: 'intermediate' }, // room = 1, requested = 3 -> floor wins at 2
    )
    expect(p.sets).toBe(2)
    expect(p.reason).toMatch(/protect recovery/i)
  })
})
