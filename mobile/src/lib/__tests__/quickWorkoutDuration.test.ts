// Regression cover for the Quick Workout duration promise (2026-07-22).
//
// Quick Workout's entire pitch is "pick your time — Tempo builds a session that
// fits right now". That broke because TWO independent estimators disagreed:
// quickWorkout's own exerciseCostSeconds budgeted with 30s setup and rest only
// BETWEEN sets, while lib/durationEstimate.estimateSessionSec — the one the
// runner actually shows the moment the session opens — uses SETUP_SEC (90) and
// counts a rest per set. A "15-Minute Muscle Builder" opened reading
// "EST. 21 MINS", observed in the running app.
//
// These tests assert the property that matters to the user rather than any
// particular exercise count: whatever the builder produces, the number the
// RUNNER will display must fit inside the window the user asked for. That holds
// the two estimators together no matter how the schemes are later re-tuned.

import { createFakeSupabase } from './fakeSupabase'

jest.mock('@/lib/moveWorkout', () => ({ resyncMovedWorkout: jest.fn() }))
jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn(), captureException: jest.fn() }))

import { generateQuickWorkout } from '@/lib/quickWorkout'
import type { ProfileForQuick } from '@/lib/quickWorkout'
import { estimateSessionSec } from '@/lib/durationEstimate'

const USER = 'user-1'

function exRow(id: string, name: string, pattern: string, muscles: string[]) {
  return {
    id, name, movement_pattern: pattern, primary_muscles: muscles, secondary_muscles: [],
    required_equipment: ['bodyweight'], experience_level: 'beginner', is_core: true, popularity: 1,
    user_id: null,
  }
}

// A deliberately deep pool across every pattern the schemes prioritise, so the
// builder is limited by its TIME BUDGET and never by running out of candidates —
// otherwise these tests would pass for the wrong reason.
const POOL = [
  exRow('sq-1', 'Goblet Squat', 'squat', ['quads']),
  exRow('sq-2', 'Split Squat', 'squat', ['quads']),
  exRow('hi-1', 'Glute Bridge', 'hinge', ['glutes']),
  exRow('hi-2', 'Good Morning', 'hinge', ['hamstrings']),
  exRow('pu-1', 'Push-Up', 'push', ['chest']),
  exRow('pu-2', 'Overhead Press', 'push', ['shoulders']),
  exRow('pl-1', 'Dumbbell Row', 'pull', ['back']),
  exRow('pl-2', 'Face Pull', 'pull', ['back']),
  exRow('co-1', 'Plank', 'core', ['abs']),
  exRow('co-2', 'Dead Bug', 'core', ['abs']),
  exRow('ca-1', 'Jumping Jacks', 'cardio', ['full_body']),
  exRow('ca-2', 'Mountain Climbers', 'cardio', ['full_body']),
]

const PROFILE: ProfileForQuick = { goal: 'muscle_gain', experience: 'beginner', equipment: [] }

/** The estimate the RUNNER will show for this built session, in minutes. */
function runnerEstimateMin(exercises: { sets: number; restSeconds: number }[]): number {
  return estimateSessionSec(
    exercises.map(ex => ({ sets: ex.sets, restSec: ex.restSeconds, workSec: null })),
  ) / 60
}

describe('quickWorkout — the session fits the window the user picked', () => {
  const DURATIONS = [10, 15, 20, 30, 45, 60] as const

  it.each(DURATIONS)('a %i-minute request builds a session the runner estimates within %i minutes', async (minutes) => {
    const client = createFakeSupabase({ exercises: POOL, user_profiles: [] })
    const w = await generateQuickWorkout(client, USER, { minutes }, PROFILE)

    expect(w.exercises.length).toBeGreaterThan(0)

    // The promise: the runner's own number must not exceed the requested window.
    // Under-running is fine (a session that ends early beats one that overruns);
    // over-running is the bug this file exists to prevent.
    expect(runnerEstimateMin(w.exercises)).toBeLessThanOrEqual(minutes)
  })

  it('titles the session with the SAME number of minutes it was asked for', async () => {
    const client = createFakeSupabase({ exercises: POOL, user_profiles: [] })
    const w = await generateQuickWorkout(client, USER, { minutes: 15 }, PROFILE)

    // The title is a promise to the user ("15-Minute ..."), so it must match the
    // request — and, per the test above, the session must actually honour it.
    expect(w.title).toContain('15-Minute')
    expect(w.minutes).toBe(15)
  })

  it('still uses a real amount of the window rather than trivially under-filling it', async () => {
    // Guards the opposite failure: making the budget honest must not collapse a
    // 45-minute request into one token exercise. At least half the window is used.
    const client = createFakeSupabase({ exercises: POOL, user_profiles: [] })
    const w = await generateQuickWorkout(client, USER, { minutes: 45 }, PROFILE)

    expect(runnerEstimateMin(w.exercises)).toBeGreaterThan(45 * 0.5)
  })
})
