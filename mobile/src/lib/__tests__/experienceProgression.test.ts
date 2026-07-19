// Regression coverage for MASTER_FIX_PLAN.md F3 — maybePromoteExperience used
// to write the new `experience` level and then unconditionally fire the
// "LEVEL UP" celebration + restamp future plan rows, even if that write
// failed. A failed write must mean NO promotion at all (the caller,
// workout-complete.tsx, only celebrates a truthy return value) — otherwise
// the user sees a promotion that evaporates the next time the profile is
// read from the server, and the plan gets restamped against a level the
// profile was never actually updated to.

import { createFakeSupabase } from './fakeSupabase'
import { maybePromoteExperience } from '@/lib/experienceProgression'

// restampFuturePlanForExperience pulls in generatePlan.ts's own transitive
// chain (retireWorkouts -> calendarSync -> expo-calendar); mocked away
// entirely since the write-failure path under test must never reach it.
const restampMock = jest.fn().mockResolvedValue(0)
jest.mock('@/lib/generatePlan', () => ({
  restampFuturePlanForExperience: (...args: unknown[]) => restampMock(...args),
}))

const USER = 'user-1'

function tenCompletedSessions() {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `w${i}`, user_id: USER, status: 'completed',
  }))
}

describe('maybePromoteExperience — a failed write must not promote (F3)', () => {
  beforeEach(() => restampMock.mockClear())

  it('promotes normally when the experience write succeeds', async () => {
    const tables: Record<string, any[]> = {
      user_profiles: [{ user_id: USER, experience: 'beginner' }],
      user_plans: [],
      scheduled_workouts: tenCompletedSessions(),
      adaptation_events: [],
    }
    const client = createFakeSupabase(tables)

    const result = await maybePromoteExperience(client, USER)

    expect(result).toEqual({ from: 'beginner', to: 'intermediate' })
    expect(tables.user_profiles[0].experience).toBe('intermediate')
    expect(restampMock).toHaveBeenCalledTimes(1)
  })

  it('returns null and never restamps when the experience write fails', async () => {
    const tables: Record<string, any[]> = {
      user_profiles: [{ user_id: USER, experience: 'beginner' }],
      user_plans: [],
      scheduled_workouts: tenCompletedSessions(),
      adaptation_events: [],
    }
    const client = createFakeSupabase(tables, { failOps: new Set(['user_profiles.update']) })

    const result = await maybePromoteExperience(client, USER)

    // No promotion object -> workout-complete.tsx's `if (!p) return` means no
    // celebration fires and refreshProfile() is never called.
    expect(result).toBeNull()
    // The row must be left exactly as it was — no silent partial state.
    expect(tables.user_profiles[0].experience).toBe('beginner')
    // The whole point of the fix: a failed write must gate the restamp too.
    expect(restampMock).not.toHaveBeenCalled()
  })
})
