// Coverage for lib/exerciseExclusions.ts — the "never suggest this exercise
// again" list a live workout session can add to (plan.tsx's "Remove
// permanently"). Every plan/split/quick-workout generation path filters
// against this, so it has to actually persist and dedupe correctly.

import { createFakeSupabase } from './fakeSupabase'
import { fetchExcludedExerciseIds, excludeExercisePermanently } from '@/lib/exerciseExclusions'

const USER = 'user-1'

describe('exerciseExclusions', () => {
  it('fetchExcludedExerciseIds returns an empty set when the profile has none', async () => {
    const client = createFakeSupabase({
      user_profiles: [{ user_id: USER, excluded_exercise_ids: [] }],
    })
    const ids = await fetchExcludedExerciseIds(client, USER)
    expect(ids.size).toBe(0)
  })

  it('fetchExcludedExerciseIds reads existing exclusions', async () => {
    const client = createFakeSupabase({
      user_profiles: [{ user_id: USER, excluded_exercise_ids: ['ex-1', 'ex-2'] }],
    })
    const ids = await fetchExcludedExerciseIds(client, USER)
    expect(ids.has('ex-1')).toBe(true)
    expect(ids.has('ex-2')).toBe(true)
  })

  it('excludeExercisePermanently adds a new id without dropping existing ones', async () => {
    const tables = { user_profiles: [{ user_id: USER, excluded_exercise_ids: ['ex-1'] }] }
    const client = createFakeSupabase(tables)

    await excludeExercisePermanently(client, USER, 'ex-2')

    const after = await fetchExcludedExerciseIds(client, USER)
    expect(after.has('ex-1')).toBe(true)
    expect(after.has('ex-2')).toBe(true)
  })

  it('excludeExercisePermanently is a no-op when the id is already excluded (no duplicate)', async () => {
    const tables = { user_profiles: [{ user_id: USER, excluded_exercise_ids: ['ex-1'] }] }
    const client = createFakeSupabase(tables)

    await excludeExercisePermanently(client, USER, 'ex-1')

    const after = await fetchExcludedExerciseIds(client, USER)
    expect([...after]).toEqual(['ex-1'])
  })
})
