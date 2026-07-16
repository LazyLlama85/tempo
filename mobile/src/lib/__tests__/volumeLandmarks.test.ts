import { landmarkFor, isLandmarkMuscleGroup, titrateForWeeklyVolume } from '@/lib/volumeLandmarks'

describe('volumeLandmarks — landmark table', () => {
  it('scales MRV by experience without moving MEV', () => {
    const beg = landmarkFor('chest', 'beginner')
    const int = landmarkFor('chest', 'intermediate')
    const adv = landmarkFor('chest', 'advanced')
    expect(beg.mev).toBe(int.mev)
    expect(adv.mev).toBe(int.mev)
    expect(beg.mrv).toBeLessThan(int.mrv)
    expect(adv.mrv).toBeGreaterThan(int.mrv)
  })

  it('every landmark has mrv > mev (a non-empty effective range)', () => {
    for (const g of ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'] as const) {
      for (const exp of ['beginner', 'intermediate', 'advanced'] as const) {
        const l = landmarkFor(g, exp)
        expect(l.mrv).toBeGreaterThan(l.mev)
      }
    }
  })

  it('isLandmarkMuscleGroup rejects non-landmark buckets (cardio/mobility/glutes/null) without throwing', () => {
    expect(isLandmarkMuscleGroup('chest')).toBe(true)
    expect(isLandmarkMuscleGroup('cardio')).toBe(false)
    expect(isLandmarkMuscleGroup('mobility')).toBe(false)
    expect(isLandmarkMuscleGroup(null)).toBe(false)
    expect(isLandmarkMuscleGroup(undefined)).toBe(false)
  })
})

describe('titrateForWeeklyVolume — the MRV cap', () => {
  it('is a no-op when there is room left this week', () => {
    const r = titrateForWeeklyVolume(3, 'chest', 4, 'intermediate') // MRV 20, 4+3=7
    expect(r).toEqual({ sets: 3, capped: false })
  })

  it('caps to exactly the remaining room when there is at least the 2-set floor of room', () => {
    // chest MRV(intermediate) = 20; already at 17 this week (3 of room); requesting 4 more sets.
    const r = titrateForWeeklyVolume(4, 'chest', 17, 'intermediate')
    expect(r.capped).toBe(true)
    expect(r.sets).toBe(3) // 20 - 17
    expect(r.note).toMatch(/protect recovery/i)
  })

  it('the 2-set floor wins over strict MRV math when room drops below it (a near-zero session is worse than 1-2 sets over)', () => {
    // chest MRV(intermediate) = 20; already at 19 (only 1 of room); requesting 4.
    const r = titrateForWeeklyVolume(4, 'chest', 19, 'intermediate')
    expect(r.capped).toBe(true)
    expect(r.sets).toBe(2) // floor wins, even though 19+2=21 is 1 over MRV
  })

  it('never caps below the sane 2-set floor even when already over MRV', () => {
    const r = titrateForWeeklyVolume(3, 'chest', 25, 'intermediate') // already 5 over MRV
    expect(r.sets).toBe(2)
    expect(r.capped).toBe(true)
  })

  it('is exactly a no-op at the boundary (room === requestedSets)', () => {
    const r = titrateForWeeklyVolume(1, 'chest', 19, 'intermediate') // 19+1=20, exactly MRV
    expect(r).toEqual({ sets: 1, capped: false })
  })

  it('respects the experience-scaled MRV, not a flat one', () => {
    // legs MRV: beginner ~13 (18*0.7 rounded), advanced ~23 (18*1.25 rounded).
    const beginner = titrateForWeeklyVolume(4, 'legs', 12, 'beginner')
    const advanced = titrateForWeeklyVolume(4, 'legs', 12, 'advanced')
    expect(beginner.capped).toBe(true)   // 12+4=16 > beginner MRV
    expect(advanced.capped).toBe(false)  // 12+4=16 <= advanced MRV
  })
})
