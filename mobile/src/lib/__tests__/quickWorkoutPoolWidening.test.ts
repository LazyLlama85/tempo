// Regression cover for the founder-reported "Quick Workout always gives me Core no
// matter what I select" bug (2026-08-11).
//
// Root cause: the curated `is_core` staple pool (~60 hand-picked exercises) is
// deliberately small, and for a no-equipment user it has ZERO genuinely
// no-apparatus "pull" exercise at all — so a Target Area like "Back" or "Arms"
// filtered down to nothing in the curated pool alone, silently fell through to the
// UNFILTERED pool (dropping the muscle target entirely), which for a
// bodyweight-only candidate set skews heavily toward Core/Plank-type moves. The fix
// widens to the full imported library (still muscle-filtered) whenever the curated
// pool alone can't fill the requested session length, before ever giving up on the
// target muscles.

import { createFakeSupabase } from './fakeSupabase'

jest.mock('@/lib/moveWorkout', () => ({ resyncMovedWorkout: jest.fn() }))
jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn(), captureException: jest.fn() }))

import { generateQuickWorkout, TARGET_AREA_OPTIONS } from '@/lib/quickWorkout'
import type { ProfileForQuick } from '@/lib/quickWorkout'

const USER = 'user-1'

function exRow(
  id: string, name: string, pattern: string, muscles: string[],
  opts: { equipment?: string[]; isCore?: boolean } = {},
) {
  return {
    id, name, movement_pattern: pattern, primary_muscles: muscles, secondary_muscles: [],
    required_equipment: opts.equipment ?? ['bodyweight'], experience_level: 'beginner',
    is_core: opts.isCore ?? true, popularity: 30, user_id: null,
  }
}

// No equipment selected at all: expandEquipment always adds 'bodyweight', but
// nothing else — so no pull-up bar, no bands, no weights.
const NO_EQUIPMENT_PROFILE: ProfileForQuick = { goal: 'general_fitness', experience: 'beginner', equipment: [] }

describe('quickWorkout — widening to the full library when the curated pool is thin', () => {
  it('a no-equipment "Back" request pulls real back exercises from the full library instead of defaulting to Core', async () => {
    const tables = {
      exercises: [
        // The curated ("is_core") staple pool: every "pull" exercise needs real
        // equipment (matching production — Dumbbell Row, Barbell Row, Lat
        // Pulldown, Pull-Up all require gear or a bar) — so NOTHING in the
        // curated set can train Back with zero equipment. Core has plenty of
        // bodyweight staples, which is exactly what used to leak in instead.
        exRow('curated-pull', 'Dumbbell Row', 'pull', ['lats', 'upper_back'], { equipment: ['dumbbells'] }),
        exRow('curated-squat', 'Bodyweight Squat', 'squat', ['quads', 'glutes']),
        exRow('curated-push', 'Push-Up', 'push', ['chest', 'triceps']),
        exRow('curated-core-1', 'Plank', 'core', ['abs']),
        exRow('curated-core-2', 'Dead Bug', 'core', ['abs']),
        exRow('curated-core-3', 'Hollow Body Hold', 'core', ['abs']),
        exRow('curated-core-4', 'Russian Twist', 'core', ['obliques']),
        // The FULL imported library has genuine no-equipment back options that
        // simply never made the 60-exercise curated cut.
        exRow('full-back-1', 'Superman', 'pull', ['lower_back', 'erectors'], { isCore: false }),
        exRow('full-back-2', 'Bird Dog', 'pull', ['lower_back', 'erectors'], { isCore: false }),
        exRow('full-back-3', 'Reverse Snow Angel', 'pull', ['upper_back', 'traps'], { isCore: false }),
      ],
      user_profiles: [],
    }
    const client = createFakeSupabase(tables)
    const backOption = TARGET_AREA_OPTIONS.find(o => o.key === 'back')!

    const w = await generateQuickWorkout(
      client, USER,
      { minutes: 30, purpose: 'muscle_growth', targetMuscles: backOption.muscles, targetAreaLabel: backOption.label },
      NO_EQUIPMENT_PROFILE,
    )

    expect(w.exercises.length).toBeGreaterThan(0)
    // Every exercise actually trains a back muscle — no silent drop to Core/full-body.
    for (const ex of w.exercises) {
      expect(ex.primary_muscles.some(m => backOption.muscles!.includes(m))).toBe(true)
    }
    // The full-library back exercises were actually used, not just the curated pool.
    expect(w.exercises.some(ex => ex.id.startsWith('full-back'))).toBe(true)
  })

  it('does not widen to the full library when the curated pool already has enough for the requested length', async () => {
    const tables = {
      exercises: [
        exRow('curated-1', 'Goblet Squat', 'squat', ['quads']),
        exRow('curated-2', 'Split Squat', 'squat', ['quads']),
        exRow('curated-3', 'Leg Press', 'squat', ['quads'], { equipment: ['full_gym'] }),
        exRow('curated-4', 'Leg Extension', 'squat', ['quads'], { equipment: ['full_gym'] }),
        // A full-library duplicate that must NOT be picked while the curated
        // pool alone already covers the (short) session.
        exRow('full-1', 'ExerciseDB Leg Variant', 'squat', ['quads'], { isCore: false }),
      ],
      user_profiles: [],
    }
    const client = createFakeSupabase(tables)
    const legsOption = TARGET_AREA_OPTIONS.find(o => o.key === 'legs')!
    const fullGymProfile: ProfileForQuick = { goal: 'general_fitness', experience: 'beginner', equipment: ['full_gym'] }

    // 10 minutes → maxExercisesFor caps at 4, and the curated pool already has 4.
    const w = await generateQuickWorkout(
      client, USER,
      { minutes: 10, purpose: 'muscle_growth', targetMuscles: legsOption.muscles },
      fullGymProfile,
    )

    expect(w.exercises.length).toBeGreaterThan(0)
    expect(w.exercises.every(ex => ex.id.startsWith('curated'))).toBe(true)
  })
})
