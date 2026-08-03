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

  it('a muscle-targeted pick is never empty just because the training style\'s own pattern list excludes it', async () => {
    // Real bug found via the founder's report + a live-DB check: beginner/
    // bodyweight Arms matches are ALL 'push' pattern (Bench Dip, Push-Up) --
    // and Mobility's patternPriority (['mobility','core','hinge','squat','pull'])
    // doesn't include 'push' at all. Before forcePatterns, this combination
    // silently produced zero exercises even though real matches existed.
    const tables = {
      exercises: [
        exRow('arm-1', 'Bench Dip', 'push', ['triceps']),
        exRow('arm-2', 'Push-Up', 'push', ['chest', 'triceps', 'shoulders']),
        exRow('leg-1', 'Squat', 'squat', ['quads']),
      ],
      user_profiles: [],
    }
    const client = createFakeSupabase(tables)
    const armOption = TARGET_AREA_OPTIONS.find(o => o.key === 'arms')!

    const w = await generateQuickWorkout(
      client, USER,
      { minutes: 15, purpose: 'mobility', targetMuscles: armOption.muscles },
      PROFILE,
    )

    expect(w.exercises.length).toBeGreaterThan(0)
    for (const ex of w.exercises) expect(['arm-1', 'arm-2']).toContain(ex.id)
  })

  it('a cardio-pattern exercise does not leak into a strength-purpose Target Area workout just because a muscle overlaps', async () => {
    // Real bug, founder-reported: picking "Legs" for a muscle_growth/strength
    // session recommended Jump Rope purely because Jump Rope's primary_muscles
    // include 'calves' (a real leg muscle) — even though Jump Rope's
    // movement_pattern is 'cardio', which muscle_growth's own patternPriority
    // never wants. forcePatterns used to force EVERY pattern present in the
    // muscle-filtered pool, cardio included; now it only force-includes
    // cardio/mobility when the ACTIVE purpose's own scheme already wants them.
    const tables = {
      exercises: [
        exRow('leg-squat', 'Goblet Squat', 'squat', ['quads', 'glutes']),
        exRow('leg-hinge', 'Romanian Deadlift', 'hinge', ['hamstrings', 'glutes']),
        exRow('leg-cardio', 'Jump Rope', 'cardio', ['calves', 'shoulders']),
      ],
      user_profiles: [],
    }
    const client = createFakeSupabase(tables)
    const legsOption = TARGET_AREA_OPTIONS.find(o => o.key === 'legs')!

    const w = await generateQuickWorkout(
      client, USER,
      { minutes: 40, purpose: 'muscle_growth', targetMuscles: legsOption.muscles },
      PROFILE,
    )

    expect(w.exercises.length).toBeGreaterThan(0)
    expect(w.exercises.some(ex => ex.id === 'leg-cardio')).toBe(false)
  })

  it('a cardio-pattern exercise IS included in a Target Area workout when the purpose actually wants cardio', async () => {
    const tables = {
      exercises: [
        exRow('leg-squat', 'Goblet Squat', 'squat', ['quads', 'glutes']),
        exRow('leg-cardio', 'Jump Rope', 'cardio', ['calves']),
      ],
      user_profiles: [],
    }
    const client = createFakeSupabase(tables)
    const legsOption = TARGET_AREA_OPTIONS.find(o => o.key === 'legs')!

    const w = await generateQuickWorkout(
      client, USER,
      { minutes: 40, purpose: 'conditioning', targetMuscles: legsOption.muscles },
      PROFILE,
    )

    expect(w.exercises.some(ex => ex.id === 'leg-cardio')).toBe(true)
  })

  it('every non-cardio, non-"pick for me" option has a non-empty muscle list, and Cardio uses the pattern instead', () => {
    for (const opt of TARGET_AREA_OPTIONS) {
      if (opt.key === 'cardio') {
        expect(opt.pattern).toBe('cardio')
        expect(opt.muscles).toBeUndefined()
      } else if (opt.surprise) {
        expect(opt.muscles).toBeUndefined()
        expect(opt.pattern).toBeUndefined()
      } else {
        expect(opt.muscles?.length).toBeGreaterThan(0)
        expect(opt.pattern).toBeUndefined()
      }
    }
  })
})
