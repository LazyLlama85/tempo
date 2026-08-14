// Regression cover for the founder-reported "the app is super slow, genuinely
// cannot be used" investigation (2026-08-14).
//
// Root cause found in the live request log: with travel mode ON,
// syncTravelSchedule rewrote EVERY upcoming plan/split session on EVERY app
// open — ~25 single-row PATCHes, awaited one at a time (~140ms each, several
// seconds of pure network), storing values byte-identical to what was already
// in the row. It had no notion of "this row is already adapted correctly", so a
// steady-state launch did the maximum possible amount of work.
//
// These tests pin the two properties that fix it:
//   1. A second run with unchanged equipment writes NOTHING.
//   2. A real change still writes (the optimisation can't silently disable the
//      feature).

import { createFakeSupabase } from './fakeSupabase'

jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn(), captureException: jest.fn() }))

import { syncTravelSchedule } from '@/lib/travelSchedule'

const USER = 'user-1'

// Far enough ahead that todayStr() can never filter these out.
const FUTURE = '2099-01-01'

function exercise(id: string, equipment: string[], pattern = 'push', muscles = ['chest']) {
  return {
    id,
    name: `Ex ${id}`,
    movement_pattern: pattern,
    required_equipment: equipment,
    primary_muscles: muscles,
    is_core: true,
    popularity: 50,
    substitute_ids: [],
    user_id: null,
  }
}

function baseTables() {
  return {
    user_profiles: [
      { user_id: USER, travel_mode: { equipment: ['dumbbells'], until: FUTURE, label: 'Hotel' } },
    ],
    exercises: [
      // Needs a barbell — unavailable while travelling, so it must be swapped.
      exercise('barbell-press', ['barbell']),
      // The dumbbell alternative the remap should land on.
      exercise('db-press', ['dumbbells']),
    ],
    scheduled_workouts: [
      {
        id: 'w1',
        user_id: USER,
        status: 'scheduled',
        planned_date: FUTURE,
        source: 'plan',
        exercise_ids: ['barbell-press'],
        exercise_config: null,
        travel_restore: null,
      },
    ],
  }
}

describe('syncTravelSchedule — no-op detection on repeat app opens', () => {
  it('adapts on the first run, then writes nothing on an identical second run', async () => {
    const client = createFakeSupabase(baseTables())

    // First open while travelling: the barbell lift has to be swapped out.
    const firstRun = await syncTravelSchedule(client, USER)
    expect(firstRun).toBe(1)

    // Second open, nothing about the user or their gear changed. Before the fix
    // this returned 1 again (and issued another PATCH) every single launch.
    const secondRun = await syncTravelSchedule(client, USER)
    expect(secondRun).toBe(0)

    // And a third, to be sure it's genuinely steady-state rather than alternating.
    expect(await syncTravelSchedule(client, USER)).toBe(0)
  })

  it('still writes when the equipment actually changes', async () => {
    const tables = baseTables()
    const client = createFakeSupabase(tables)

    expect(await syncTravelSchedule(client, USER)).toBe(1)
    expect(await syncTravelSchedule(client, USER)).toBe(0)

    // Travel ends — the original barbell lift must be restored, so this is a
    // real write, not a no-op.
    tables.user_profiles[0].travel_mode = null as never
    expect(await syncTravelSchedule(client, USER)).toBe(1)

    // ...and once restored, it stays quiet again.
    expect(await syncTravelSchedule(client, USER)).toBe(0)
  })
})
