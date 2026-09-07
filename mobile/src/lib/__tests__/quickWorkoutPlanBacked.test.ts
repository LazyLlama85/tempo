// "Pick for me" should give you a shortened version of the session you already
// have — and must never collapse to an all-core session.
//
// Founder, 2026-09-07, second bad Quick Workout in a week: a 60-minute "Full
// Body" that was four ab exercises. Two of his real rows:
//
//   "60-Minute Full Body Muscle" -> Plank, Cable Crunch, Hanging Leg Raise, Lying Leg Raise
//   "15-Minute Full Body Muscle" -> Ab Wheel Rollout, Hollow Body Hold, Dead Bug
//
// Neither user had exclusions or injuries, both were full-gym, and one had no
// training history at all — so the engine itself was fine. The cause was
// getScheduleRestrictions: it avoids the movement patterns of every session
// scheduled from yesterday to +2 days, so someone training 5-6 days a week on
// Push/Pull/Legs has all three inside that window. focusToPatterns then avoids
// push, pull, squat AND hinge — every resistance pattern there is — and the pool
// collapses to core, with nothing to stop it.
//
// Two fixes, tested separately:
//   1. A floor: if avoiding what is scheduled would leave no resistance pattern
//      at all, the preference is dropped. Avoiding a scheduled muscle is a
//      preference; producing a usable workout is the requirement.
//   2. The founder's own idea, and the better answer: with no Target Area
//      selected, serve a TRIMMED version of the session already on the plan
//      rather than something unrelated.

jest.mock('@/lib/moveWorkout', () => ({ resyncMovedWorkout: jest.fn() }))
jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn(), captureException: jest.fn() }))

import { createFakeSupabase } from './fakeSupabase'
import { generateQuickWorkout, getScheduleRestrictions } from '@/lib/quickWorkout'
import type { ProfileForQuick } from '@/lib/quickWorkout'

const USER = 'user-1'
const GYM: ProfileForQuick = {
  goal: 'muscle_gain', experience: 'advanced', equipment: ['full_gym'],
}

function ex(id: string, name: string, pattern: string, primary: string[]) {
  return {
    id, name, movement_pattern: pattern, primary_muscles: primary, secondary_muscles: [],
    required_equipment: ['full_gym'], experience_level: 'beginner',
    is_core: true, popularity: 60, user_id: null,
  }
}

const CATALOGUE = [
  ex('squat-1', 'Barbell Back Squat', 'squat', ['quads']),
  ex('squat-2', 'Leg Press', 'squat', ['quads']),
  ex('hinge-1', 'Romanian Deadlift', 'hinge', ['hamstrings']),
  ex('hinge-2', 'Leg Curl', 'hinge', ['hamstrings']),
  ex('push-1', 'Barbell Bench Press', 'push', ['chest']),
  ex('push-2', 'Overhead Press', 'push', ['shoulders']),
  ex('pull-1', 'Barbell Bent-Over Row', 'pull', ['lats']),
  ex('pull-2', 'Lat Pulldown', 'pull', ['lats']),
  ex('core-1', 'Plank', 'core', ['abs']),
  ex('core-2', 'Cable Crunch', 'core', ['abs']),
  ex('core-3', 'Hanging Leg Raise', 'core', ['abs']),
  ex('core-4', 'Lying Leg Raise', 'core', ['abs']),
]

const today = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10)

/** A 6-day PPL athlete: Push today, Pull tomorrow, Legs the day after. */
function ppl() {
  const d2 = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)
  return [
    { id: 'w1', user_id: USER, focus: 'Push', status: 'scheduled', planned_date: today,
      exercise_ids: ['push-1', 'push-2', 'core-1'] },
    { id: 'w2', user_id: USER, focus: 'Pull', status: 'scheduled', planned_date: tomorrow,
      exercise_ids: ['pull-1', 'pull-2'] },
    { id: 'w3', user_id: USER, focus: 'Legs', status: 'scheduled', planned_date: d2,
      exercise_ids: ['squat-1', 'hinge-1'] },
  ]
}

describe('getScheduleRestrictions floor', () => {
  it('drops the preference when avoiding everything would leave nothing to train', async () => {
    const client = createFakeSupabase({ scheduled_workouts: ppl() } as never)
    const r = await getScheduleRestrictions(client, USER)
    // Push + Pull + Legs covers push, pull, squat and hinge. Rather than avoid
    // all four and leave only core, the preference is abandoned.
    expect(r.avoidPatterns).toEqual([])
  })

  it('still avoids a scheduled pattern when other real work remains', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [
        { id: 'w1', user_id: USER, focus: 'Legs', status: 'scheduled', planned_date: tomorrow,
          exercise_ids: ['squat-1'] },
      ],
    } as never)
    const r = await getScheduleRestrictions(client, USER)
    // Legs tomorrow -> don't pre-empt it; push and pull are still available.
    expect(r.avoidPatterns.sort()).toEqual(['hinge', 'squat'])
  })
})

describe('"Pick for me" is backed by the plan', () => {
  it('gives a shortened version of the session already scheduled', async () => {
    const client = createFakeSupabase({
      exercises: CATALOGUE, user_profiles: [], scheduled_workouts: ppl(),
    } as never)

    const w = await generateQuickWorkout(
      client, USER, { minutes: 15 as never, purpose: 'muscle_growth' }, GYM,
    )

    // Today's session is Push — that is what a 15-minute window should serve.
    expect(w.title).toContain('Push')
    expect(w.focusLabel).toBe('Quick · Push')
    for (const e of w.exercises) expect(['push-1', 'push-2', 'core-1']).toContain(e.id)
    // Prefix of the plan's own order, so the main lift survives the trim.
    expect(w.exercises[0].id).toBe('push-1')
    // The copy names the session and the day it comes from, so it reads as
    // "your Push from today" rather than an anonymous generated workout.
    expect(w.why).toContain('Push')
    expect(w.why).toContain('today')
  })

  it('never returns an all-core session for a 60-minute Full Body request', async () => {
    // The exact reported failure.
    const client = createFakeSupabase({
      exercises: CATALOGUE, user_profiles: [], scheduled_workouts: ppl(),
    } as never)

    const w = await generateQuickWorkout(
      client, USER, { minutes: 60 as never, purpose: 'muscle_growth' }, GYM,
    )

    expect(w.exercises.length).toBeGreaterThan(0)
    const allCore = w.exercises.every(e => e.movement_pattern === 'core')
    expect(allCore).toBe(false)
  })

  it('falls back to the normal generator when nothing is scheduled', async () => {
    const client = createFakeSupabase({
      exercises: CATALOGUE, user_profiles: [], scheduled_workouts: [],
    } as never)

    const w = await generateQuickWorkout(
      client, USER, { minutes: 45 as never, purpose: 'muscle_growth' }, GYM,
    )

    expect(w.title).toContain('Full Body')
    expect(w.exercises.length).toBeGreaterThan(0)
    expect(w.exercises.every(e => e.movement_pattern === 'core')).toBe(false)
  })

  it('names the session by how long it ACTUALLY runs, not the window asked for', async () => {
    // A Quick Workout is not necessarily quicker than the planned session.
    // Asking for 60 minutes when today's Push is 3 exercises gets the whole
    // session, and the title must not claim 60 minutes of work that isn't there.
    const client = createFakeSupabase({
      exercises: CATALOGUE, user_profiles: [], scheduled_workouts: ppl(),
    } as never)

    const w = await generateQuickWorkout(
      client, USER, { minutes: 60 as never, purpose: 'muscle_growth' }, GYM,
    )

    expect(w.title).toBe(`${w.estimatedMinutes}-Minute Push`)
    expect(w.estimatedMinutes).toBeLessThan(60)
    // And it says so plainly rather than implying it filled the hour.
    expect(w.why).toContain('60')
    expect(w.why.toLowerCase()).toContain('fits')
  })

  it('an explicit Target Area is still answered literally, not with the plan', async () => {
    // "Give me Arms" is a specific request. It must not be quietly replaced by
    // today's Push session just because one exists.
    const client = createFakeSupabase({
      exercises: [...CATALOGUE, ex('bi-1', 'Barbell Curl', 'pull', ['biceps'])],
      user_profiles: [], scheduled_workouts: ppl(),
    } as never)

    const w = await generateQuickWorkout(
      client, USER,
      { minutes: 15 as never, purpose: 'muscle_growth', targetMuscles: ['biceps', 'triceps', 'forearms'], targetAreaLabel: 'Arms' },
      GYM,
    )

    expect(w.title).toContain('Arms')
    expect(w.exercises.every(e => e.id === 'bi-1')).toBe(true)
  })
})
