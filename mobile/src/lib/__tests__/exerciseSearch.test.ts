// searchLibrary is pure, but exerciseSearch.ts shares a module with
// fetchLibrary/useExerciseLibrary, which import the real Supabase client at
// load time — neutralize it the same way other lib tests do for modules that
// pull in side-effecting imports (see retireWorkouts.test.ts).
jest.mock('@/lib/supabase', () => ({ supabase: {} }))

import { searchLibrary } from '@/lib/exerciseSearch'
import type { Exercise } from '@/types'

function ex(overrides: Partial<Exercise>): Exercise {
  return {
    id: overrides.id ?? overrides.name ?? 'ex',
    name: 'Exercise',
    movement_pattern: 'push',
    primary_muscles: [],
    secondary_muscles: [],
    required_equipment: ['bodyweight'],
    experience_level: 'beginner',
    video_url: null,
    instructions: [],
    substitute_ids: [],
    ...overrides,
  } as Exercise
}

describe('searchLibrary — colloquial muscle-name aliases', () => {
  const library: Exercise[] = [
    ex({ id: '1', name: 'Hip Adductor Machine', movement_pattern: 'squat', primary_muscles: ['adductors'] }),
    ex({ id: '2', name: 'Cable Hip Abduction', movement_pattern: 'squat', primary_muscles: ['abductors'] }),
    ex({ id: '3', name: 'Bench Press', movement_pattern: 'push', primary_muscles: ['chest'] }),
  ]

  it('"inner thigh" finds the hip adductor exercise, not unrelated ones', () => {
    const results = searchLibrary(library, 'inner thigh')
    expect(results.map(r => r.id)).toContain('1')
    expect(results.map(r => r.id)).not.toContain('3')
  })

  it('"inner thighs" (plural) finds the same exercise', () => {
    const results = searchLibrary(library, 'inner thighs')
    expect(results.map(r => r.id)).toContain('1')
  })

  it('"outer thigh" finds the abductor exercise', () => {
    const results = searchLibrary(library, 'outer thigh')
    expect(results.map(r => r.id)).toContain('2')
    expect(results.map(r => r.id)).not.toContain('1')
  })
})
