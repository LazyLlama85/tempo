// A Target Area request must return exercises for THAT area.
//
// Founder, 2026-09-04, with a screenshot: a "40-Minute Legs" Quick Workout came
// back as a single Hollow Body Hold estimated at 5 minutes. Pulling his real
// rows out of `scheduled_workouts` showed it was not a one-off, and that three
// separate target areas were leaking:
//
//   "40-Minute Legs Muscle"       -> Power Clean, Hollow Body Hold, Hanging Leg Raise
//   "15-Minute Arms Conditioning" -> Barbell Bench Press, Barbell Curl, Push-Up
//   "60-Minute Upper Body Muscle" -> Conventional Deadlift, Hyperextension,
//                                    Machine Back Extension, and no pressing at all
//
// Two causes, both fixed and both covered here:
//
//  1. Group membership. `hip_flexors` was listed under LEG_MUSCLES, and every
//     exercise in this catalogue with `hip_flexors` as a primary muscle is an ab
//     exercise (Hollow Body Hold and Hanging Leg Raise are both
//     ['abs','hip_flexors']). `lower_back`/`erectors` sat under BACK_MUSCLES,
//     which "Upper Body" was built from, so deadlifts counted as upper body.
//
//  2. Loose matching. The pool filter accepted an exercise if ANY of its primary
//     muscles matched. Bench Press is ['chest','triceps'], so it satisfied Arms.
//     Matching now requires the DOMINANT muscle (primary_muscles[0]).
//
// The rows below are the real production values, copied out of the `exercises`
// table, so this test fails if either cause comes back.

import { createFakeSupabase } from './fakeSupabase'

jest.mock('@/lib/moveWorkout', () => ({ resyncMovedWorkout: jest.fn() }))
jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn(), captureException: jest.fn() }))

import { generateQuickWorkout, TARGET_AREA_OPTIONS } from '@/lib/quickWorkout'
import type { ProfileForQuick } from '@/lib/quickWorkout'

const USER = 'user-1'
const GYM: ProfileForQuick = {
  goal: 'muscle_gain', experience: 'intermediate', equipment: ['full_gym', 'barbell', 'dumbbells'],
}

function ex(id: string, name: string, pattern: string, primary: string[], secondary: string[] = []) {
  return {
    id, name, movement_pattern: pattern,
    primary_muscles: primary, secondary_muscles: secondary,
    required_equipment: ['full_gym'], experience_level: 'beginner',
    is_core: true, popularity: 60, user_id: null,
  }
}

// Verbatim from production. The muscle arrays are what actually caused the bugs.
const CATALOGUE = [
  // Legs
  ex('back-squat', 'Barbell Back Squat', 'squat', ['quads'], ['glutes', 'hamstrings', 'core']),
  ex('goblet-squat', 'Goblet Squat', 'squat', ['quads'], ['glutes', 'core']),
  ex('leg-press', 'Leg Press', 'squat', ['quads'], ['glutes', 'hamstrings']),
  ex('leg-curl', 'Leg Curl', 'hinge', ['hamstrings'], ['glutes']),
  ex('leg-ext', 'Leg Extension', 'squat', ['quads'], []),
  ex('rdl', 'Barbell Romanian Deadlift', 'hinge', ['hamstrings'], ['glutes', 'lower_back']),
  ex('bulgarian', 'Bulgarian Split Squat', 'squat', ['quads'], ['glutes']),
  ex('calf', 'Barbell Standing Calf Raise', 'squat', ['calves'], []),
  // Core — the two that leaked into Legs via hip_flexors
  ex('hollow', 'Hollow Body Hold', 'core', ['abs', 'hip_flexors'], ['quads', 'shoulders']),
  ex('hlr', 'Hanging Leg Raise', 'core', ['abs', 'hip_flexors'], ['lats', 'forearms']),
  ex('plank', 'Plank', 'core', ['abs'], ['core']),
  // Push — the two that leaked into Arms via triceps
  ex('bench', 'Barbell Bench Press', 'push', ['chest', 'triceps'], ['shoulders', 'core']),
  ex('pushup', 'Push-Up', 'push', ['chest', 'triceps', 'shoulders'], ['core']),
  ex('ohp', 'Barbell Overhead Press', 'push', ['shoulders'], ['triceps']),
  // Real arm isolation
  ex('curl', 'Barbell Curl', 'pull', ['biceps'], ['forearms']),
  ex('hammer', 'Dumbbell Hammer Curl', 'pull', ['biceps'], ['forearms']),
  ex('pushdown', 'Triceps Pushdown', 'push', ['triceps'], []),
  ex('skull', 'Barbell Skull Crusher', 'push', ['triceps'], []),
  // Back — deadlift/hyperextension leaked into Upper Body via erectors/lower_back
  ex('deadlift', 'Conventional Deadlift', 'hinge', ['hamstrings', 'glutes', 'erectors'], ['traps', 'lats', 'core']),
  ex('hyper', 'Hyperextension', 'hinge', ['lower_back'], ['glutes', 'hamstrings']),
  ex('backext', 'Machine Back Extension', 'hinge', ['lower_back'], ['glutes', 'hamstrings']),
  ex('row', 'Barbell Bent-Over Row', 'pull', ['lats'], ['upper_back', 'biceps']),
  ex('pulldown', 'Lat Pulldown', 'pull', ['lats'], ['biceps']),
  ex('cable-row', 'Seated Cable Row', 'pull', ['lats'], ['upper_back', 'biceps']),
]

const area = (key: string) => TARGET_AREA_OPTIONS.find(o => o.key === key)!

async function build(key: string, minutes: number) {
  const opt = area(key)
  return generateQuickWorkout(
    createFakeSupabase({ exercises: CATALOGUE, user_profiles: [] }),
    USER,
    { minutes: minutes as never, purpose: 'muscle_growth', targetMuscles: opt.muscles, targetAreaLabel: opt.label },
    GYM,
  )
}

describe('Quick Workout target areas return that area', () => {
  it('"40-Minute Legs" contains no ab exercises (the reported bug)', async () => {
    const w = await build('legs', 40)
    const names = w.exercises.map(e => e.name)
    expect(names).not.toContain('Hollow Body Hold')
    expect(names).not.toContain('Hanging Leg Raise')
    expect(names).not.toContain('Plank')
    for (const e of w.exercises) {
      expect(area('legs').muscles).toContain(e.primary_muscles[0])
    }
  })

  it('"40-Minute Legs" is a 40-minute session, not a 5-minute one', async () => {
    const w = await build('legs', 40)
    // The screenshot showed ONE exercise and "EST. 5 MINS" against a 40-minute
    // request. With a catalogue this well stocked that must not happen.
    expect(w.exercises.length).toBeGreaterThanOrEqual(4)
    expect(w.estimatedMinutes).toBeGreaterThanOrEqual(20)
  })

  it('"Arms" returns arm work, not bench press and push-ups', async () => {
    const w = await build('arms', 15)
    const names = w.exercises.map(e => e.name)
    expect(names).not.toContain('Barbell Bench Press')
    expect(names).not.toContain('Push-Up')
    for (const e of w.exercises) {
      expect(area('arms').muscles).toContain(e.primary_muscles[0])
    }
  })

  it('"Upper Body" excludes deadlifts and lower-back work', async () => {
    const w = await build('upper_body', 60)
    const names = w.exercises.map(e => e.name)
    expect(names).not.toContain('Conventional Deadlift')
    expect(names).not.toContain('Hyperextension')
    expect(names).not.toContain('Machine Back Extension')
    for (const e of w.exercises) {
      expect(area('upper_body').muscles).toContain(e.primary_muscles[0])
    }
  })

  it('"Back" still includes lower-back work, which is genuinely a back area', async () => {
    const w = await build('back', 40)
    for (const e of w.exercises) {
      expect(area('back').muscles).toContain(e.primary_muscles[0])
    }
  })

  it('"Core" claims the hip-flexor ab holds that Legs used to take', async () => {
    const w = await build('core', 20)
    for (const e of w.exercises) {
      expect(area('core').muscles).toContain(e.primary_muscles[0])
    }
    expect(w.exercises.length).toBeGreaterThan(0)
  })

  it('every area returns something, and only its own muscles', async () => {
    for (const key of ['arms', 'chest', 'back', 'shoulders', 'upper_body', 'legs', 'core']) {
      const w = await build(key, 30)
      expect(w.exercises.length).toBeGreaterThan(0)
      for (const e of w.exercises) {
        expect(area(key).muscles).toContain(e.primary_muscles[0])
      }
    }
  })
})
