// Coverage for quick-workout.tsx's redesigned Target Area chips (2026-07-21):
// muscle-based filtering in generateQuickWorkout, replacing the old
// movement-pattern-only targeting for everything except Cardio.

import { createFakeSupabase } from './fakeSupabase'

// quickWorkout.ts transitively imports lib/moveWorkout.ts -> services/calendarSync.ts
// -> services/calendarService.ts -> expo-calendar, which Jest can't parse without
// native-module transform config nothing else in this suite needed until now.
// generateQuickWorkout (what's under test here) never calls resyncMovedWorkout --
// that's persistQuickWorkout's job -- so a no-op stub is safe and accurate.
jest.mock('@/lib/moveWorkout', () => ({ resyncMovedWorkout: jest.fn() }))
jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn(), captureException: jest.fn() }))

import { generateQuickWorkout, TARGET_AREA_OPTIONS } from '@/lib/quickWorkout'
import type { ProfileForQuick } from '@/lib/quickWorkout'

const USER = 'user-1'

function exRow(id: string, name: string, pattern: string, muscles: string[]) {
  return {
    id, name, movement_pattern: pattern, primary_muscles: muscles, secondary_muscles: [],
    required_equipment: ['bodyweight'], experience_level: 'beginner', is_core: true, popularity: 1,
    user_id: null,
  }
}

const PROFILE: ProfileForQuick = { goal: 'general_fitness', experience: 'beginner', equipment: [] }

describe('quickWorkout — Target Area (targetMuscles)', () => {
  it('filters the candidate pool down to the requested muscle group', async () => {
    const tables = {
      exercises: [
        exRow('arm-1', 'Bicep Curl', 'pull', ['biceps']),
        exRow('arm-2', 'Tricep Pushdown', 'push', ['triceps']),
        exRow('chest-1', 'Bench Press', 'push', ['chest']),
        exRow('leg-1', 'Squat', 'squat', ['quads']),
      ],
      user_profiles: [],
    }
    const client = createFakeSupabase(tables)

    const armOption = TARGET_AREA_OPTIONS.find(o => o.key === 'arms')!
    const w = await generateQuickWorkout(client, USER, { minutes: 15, targetMuscles: armOption.muscles }, PROFILE)

    expect(w.exercises.length).toBeGreaterThan(0)
    for (const ex of w.exercises) {
      expect(['arm-1', 'arm-2']).toContain(ex.id)
    }
  })

  it('falls back to the full pool when the muscle group has nothing for this equipment/experience', async () => {
    const tables = {
      exercises: [
        exRow('chest-1', 'Bench Press', 'push', ['chest']),
        exRow('leg-1', 'Squat', 'squat', ['quads']),
      ],
      user_profiles: [],
    }
    const client = createFakeSupabase(tables)

    // No arm exercises exist at all in this fixture -- a real workout must
    // still come back (never an empty session just because one muscle group
    // was unavailable).
    const armOption = TARGET_AREA_OPTIONS.find(o => o.key === 'arms')!
    const w = await generateQuickWorkout(client, USER, { minutes: 15, targetMuscles: armOption.muscles }, PROFILE)

    expect(w.exercises.length).toBeGreaterThan(0)
  })

  it('every non-cardio Target Area option has a non-empty muscle list, and Cardio uses the pattern instead', () => {
    for (const opt of TARGET_AREA_OPTIONS) {
      if (opt.key === 'cardio') {
        expect(opt.pattern).toBe('cardio')
        expect(opt.muscles).toBeUndefined()
      } else {
        expect(opt.muscles?.length).toBeGreaterThan(0)
        expect(opt.pattern).toBeUndefined()
      }
    }
  })
})
