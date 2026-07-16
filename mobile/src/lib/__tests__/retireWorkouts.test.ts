// Regression coverage for the "poisoned Change Plan" bug (audit §4.2/§11.2,
// B5.5): a stranded 'scheduled' row from an older plan/split blocked the new
// plan's insert (the partial unique index scheduled_workouts_one_plan_per_day),
// which surfaced to users as "Something went wrong" on every single Change Plan.
// retireWorkouts.ts is the shared sweep both plan generation and split
// activation now run first — these tests lock its exact partitioning and
// failure-fallback behavior so the two paths can't drift apart again.

import { createFakeSupabase } from './fakeSupabase'
import { retireScheduledWorkouts, sweepScheduledPlanRows, type ReleasableRow } from '@/lib/retireWorkouts'

jest.mock('@/services/calendarSync', () => ({
  removeWorkoutFromCalendar: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/notifications', () => ({
  cancelWorkoutReminder: jest.fn().mockResolvedValue(undefined),
}))

const USER = 'user-1'

function row(over: Partial<ReleasableRow & { status: string; user_id: string; user_plan_id: string | null; source: string | null }>) {
  return {
    id: 'w1', focus: 'Push', planned_date: '2026-07-20', planned_start_time: '09:00:00',
    planned_duration_min: 45, calendar_event_id: null, calendar_provider: null,
    status: 'scheduled', user_id: USER, user_plan_id: null, source: 'custom',
    ...over,
  }
}

describe('retireScheduledWorkouts — the FK-safe partition', () => {
  it('hard-deletes rows never referenced by a workout_log', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [row({ id: 'a' }), row({ id: 'b' })],
      workout_logs: [],
    })
    await retireScheduledWorkouts(client, USER, ['a', 'b'])
    const remaining = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(remaining.map((r: any) => r.id)).toEqual([])
  })

  it('marks log-referenced rows "rescheduled" instead of deleting them (the FK has no cascade)', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [row({ id: 'a' }), row({ id: 'b' })],
      workout_logs: [{ user_id: USER, scheduled_workout_id: 'a' }],
    })
    await retireScheduledWorkouts(client, USER, ['a', 'b'])
    const remaining = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    // 'a' survives (log-referenced), marked rescheduled; 'b' is hard-deleted.
    expect(remaining.map((r: any) => r.id)).toEqual(['a'])
    expect(remaining[0].status).toBe('rescheduled')
  })

  it('falls back to marking "rescheduled" when the delete itself fails (the exact race that caused the original poisoning: a log lands between the check and the delete)', async () => {
    const client = createFakeSupabase(
      { scheduled_workouts: [row({ id: 'a' })], workout_logs: [] },
      { failOps: new Set(['scheduled_workouts.delete']) },
    )
    await retireScheduledWorkouts(client, USER, ['a'])
    const remaining = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    // Row survives (delete failed) but is still retired via the mark fallback —
    // never left stranded as 'scheduled', which is what poisoned Change Plan.
    expect(remaining).toHaveLength(1)
    expect(remaining[0].status).toBe('rescheduled')
  })

  it('is a no-op on an empty id list (never issues a wildcard delete/update)', async () => {
    const client = createFakeSupabase({ scheduled_workouts: [row({ id: 'a' })], workout_logs: [] })
    await retireScheduledWorkouts(client, USER, [])
    const remaining = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(remaining).toHaveLength(1)
    expect(remaining[0].status).toBe('scheduled')
  })
})

describe('sweepScheduledPlanRows — the ONE shared predicate (plan generation + split activation)', () => {
  // sweepScheduledPlanRows computes "today" from `new Date()` internally (no
  // injectable date param, unlike weekReschedule's pure planner) — freeze the
  // clock so "today+" is deterministic regardless of when this suite runs.
  const TODAY = '2026-07-20'
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T12:00:00`)) })
  afterEach(() => { jest.useRealTimers() })

  it('retires today+ plan-linked and split-sourced scheduled rows, and nothing else', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [
        row({ id: 'plan-today', planned_date: TODAY, user_plan_id: 'p1' }),
        row({ id: 'split-today', planned_date: TODAY, source: 'split' }),
        row({ id: 'custom-today', planned_date: TODAY, source: 'custom' }), // the user's own — never swept
        row({ id: 'plan-completed', planned_date: TODAY, user_plan_id: 'p1', status: 'completed' }), // not 'scheduled' — untouched
      ],
      workout_logs: [],
    })
    await sweepScheduledPlanRows(client, USER)
    const remaining = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    const ids = remaining.map((r: any) => r.id).sort()
    expect(ids).toEqual(['custom-today', 'plan-completed'])
  })

  it('never retires a PAST plan/split row — the missed-workout sweep needs that signal, and erasing it was part of the original bug class', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [
        row({ id: 'plan-past', planned_date: '2026-07-10', user_plan_id: 'p1' }),
        row({ id: 'plan-future', planned_date: '2026-08-01', user_plan_id: 'p1' }),
      ],
      workout_logs: [],
    })
    await sweepScheduledPlanRows(client, USER)
    const remaining = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    // The past row survives untouched; only today+ is swept.
    expect(remaining.map((r: any) => r.id)).toEqual(['plan-past'])
  })
})
