// Regression coverage for MASTER_FIX_PLAN.md F6b — musclesToRegions used a
// naive substring match (m.includes(keyword)), which misclassified
// 'lateral_deltoids' as PULL (it contains "lat", pull's keyword for "lats")
// IN ADDITION TO its correct PUSH tag, and 'abductors' as CORE (it contains
// "ab", core's keyword for "abs") in addition to its correct LEGS tag. This
// corrupted 48h recovery scoring and day-suggestion logic — a "pull day
// yesterday" false-positive could block a push day it shouldn't have.

import { musclesToRegions } from '@/lib/trainingLoad'

describe('musclesToRegions — exact match, not substring (F6b)', () => {
  it('lateral_deltoids is push only, never pull', () => {
    const regions = musclesToRegions(['lateral_deltoids'])
    expect(regions.has('push')).toBe(true)
    expect(regions.has('pull')).toBe(false)
  })

  it('abductors is legs only, never core', () => {
    const regions = musclesToRegions(['abductors'])
    expect(regions.has('legs')).toBe(true)
    expect(regions.has('core')).toBe(false)
  })

  it('adductors is legs only', () => {
    const regions = musclesToRegions(['adductors'])
    expect(regions).toEqual(new Set(['legs']))
  })

  it('lats (the real "lat" muscle) is still correctly pull', () => {
    expect(musclesToRegions(['lats'])).toEqual(new Set(['pull']))
  })

  it('abs (the real "ab" muscle) is still correctly core', () => {
    expect(musclesToRegions(['abs'])).toEqual(new Set(['core']))
  })

  it('a real multi-muscle exercise touches exactly the regions it should', () => {
    // A shoulder press: front delts + lateral delts + triceps — all push,
    // never pull via the old lateral_deltoids bug.
    const regions = musclesToRegions(['front_deltoids', 'lateral_deltoids', 'triceps'])
    expect(regions).toEqual(new Set(['push']))
  })

  it('an unknown muscle name falls back to "other" rather than throwing', () => {
    expect(musclesToRegions(['some_future_muscle'])).toEqual(new Set(['other']))
  })
})
