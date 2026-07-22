// Cover for lib/durationEstimate — the numbers the runner shows mid-session.
//
// The bug that prompted this file (2026-07-22, observed live): `elapsedSec` is
// wall-clock since the session was OPENED, so `elapsed / doneSets` is only a
// pace if the user trained the entire time. Usually they didn't — the app gets
// opened in the locker room, the phone goes down for a chat, a warm-up runs
// long. All that idle time lands on the first logged set and is extrapolated
// across every remaining one. A 15-minute session left open ~57 minutes, then
// one set logged, displayed "~1 H 21 LEFT".

import { adaptiveRemainingSec, estimateSessionSec, estimateSessionMin, SETUP_SEC, WORK_SEC, DEFAULT_REST_SEC } from '@/lib/durationEstimate'

// A typical short session: 9 sets, ~140s of static cost per set.
const STATIC_PER_SET = 140
const TOTAL_SETS = 9
const min = (sec: number) => sec / 60

describe('adaptiveRemainingSec — idle time is not pace', () => {
  it('does not extrapolate a long idle gap before the first set across the session', () => {
    // The exact shape observed in the app: session open ~57 min, one set logged.
    const remaining = adaptiveRemainingSec({
      elapsedSec: 57 * 60,
      doneSets: 1,
      totalSets: TOTAL_SETS,
      staticPerSetSec: STATIC_PER_SET,
    })
    // Previously ~81 minutes on a 15-minute workout. It must stay in the realm
    // of the session actually being performed.
    expect(min(remaining)).toBeLessThan(30)
  })

  it('is bounded no matter how absurd the elapsed clock gets', () => {
    // Someone leaves the session open overnight and logs a set in the morning.
    const remaining = adaptiveRemainingSec({
      elapsedSec: 12 * 60 * 60,
      doneSets: 1,
      totalSets: TOTAL_SETS,
      staticPerSetSec: STATIC_PER_SET,
    })
    // Hard ceiling: never more than 3x the static estimate for the work left.
    expect(remaining).toBeLessThanOrEqual((TOTAL_SETS - 1) * STATIC_PER_SET * 3)
    expect(min(remaining)).toBeLessThan(30)
  })

  it('still leaves a promptly-logged first set essentially unchanged', () => {
    // The honest case must not be damaged by the clamp: 2 minutes in, 1 set done
    // is a normal pace and should read close to the static projection.
    const remaining = adaptiveRemainingSec({
      elapsedSec: 2 * 60,
      doneSets: 1,
      totalSets: TOTAL_SETS,
      staticPerSetSec: STATIC_PER_SET,
    })
    const staticOnly = (TOTAL_SETS - 1) * STATIC_PER_SET
    expect(Math.abs(remaining - staticOnly) / staticOnly).toBeLessThan(0.15)
  })

  it('still adapts to a genuinely slower user', () => {
    // 6 sets logged at ~3.3 min each — real, sustainable, slower than planned.
    const slow = adaptiveRemainingSec({
      elapsedSec: 20 * 60, doneSets: 6, totalSets: TOTAL_SETS, staticPerSetSec: STATIC_PER_SET,
    })
    const nominal = adaptiveRemainingSec({
      elapsedSec: 6 * (STATIC_PER_SET / 60) * 60, doneSets: 6, totalSets: TOTAL_SETS, staticPerSetSec: STATIC_PER_SET,
    })
    // Clamping must not have flattened real adaptation away.
    expect(slow).toBeGreaterThan(nominal)
  })

  it('still adapts to a genuinely faster user', () => {
    const fast = adaptiveRemainingSec({
      elapsedSec: 5 * 60, doneSets: 6, totalSets: TOTAL_SETS, staticPerSetSec: STATIC_PER_SET,
    })
    expect(fast).toBeLessThan((TOTAL_SETS - 6) * STATIC_PER_SET)
    expect(fast).toBeGreaterThan(0)
  })

  it('returns the pure static projection before anything is logged', () => {
    expect(adaptiveRemainingSec({
      elapsedSec: 45 * 60, doneSets: 0, totalSets: TOTAL_SETS, staticPerSetSec: STATIC_PER_SET,
    })).toBe(TOTAL_SETS * STATIC_PER_SET)
  })

  it('returns zero once every set is done', () => {
    expect(adaptiveRemainingSec({
      elapsedSec: 40 * 60, doneSets: TOTAL_SETS, totalSets: TOTAL_SETS, staticPerSetSec: STATIC_PER_SET,
    })).toBe(0)
  })

  it('applies the historical pace factor to the static side', () => {
    const base = adaptiveRemainingSec({
      elapsedSec: 0, doneSets: 0, totalSets: TOTAL_SETS, staticPerSetSec: STATIC_PER_SET,
    })
    const slower = adaptiveRemainingSec({
      elapsedSec: 0, doneSets: 0, totalSets: TOTAL_SETS, staticPerSetSec: STATIC_PER_SET, paceFactor: 1.3,
    })
    expect(slower).toBeGreaterThan(base)
  })
})

describe('estimateSessionSec', () => {
  it('charges setup per exercise and rest per set, less the final rest', () => {
    const one = estimateSessionSec([{ sets: 3, restSec: 60, workSec: null }])
    expect(one).toBe(SETUP_SEC + 3 * (WORK_SEC + 60) - 60)
  })

  it('uses the default rest when none is prescribed', () => {
    const one = estimateSessionSec([{ sets: 2, restSec: null, workSec: null }])
    expect(one).toBe(Math.max(300, SETUP_SEC + 2 * (WORK_SEC + DEFAULT_REST_SEC) - DEFAULT_REST_SEC))
  })

  it('honours timed work (planks, carries) over the generic set duration', () => {
    const timed = estimateSessionSec([{ sets: 3, restSec: 60, workSec: 120 }])
    const lifted = estimateSessionSec([{ sets: 3, restSec: 60, workSec: null }])
    expect(timed).toBeGreaterThan(lifted)
  })

  it('never reports an implausibly tiny session', () => {
    expect(estimateSessionSec([{ sets: 1, restSec: 10, workSec: 5 }])).toBeGreaterThanOrEqual(300)
    expect(estimateSessionMin([])).toBeGreaterThanOrEqual(5)
  })
})
