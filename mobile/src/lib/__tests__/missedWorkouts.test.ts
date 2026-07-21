// Regression coverage (B5.5) for checkMissedWorkouts — shares the EXACT same
// "commitment" predicate as retireWorkouts.sweepScheduledPlanRows (plan-linked
// or split-sourced), by design (see that file's header comment): a drift
// between the two is what caused the original "poisoned Change Plan" bug
// class, so this locks the missed-side half of that shared contract.

import { createFakeSupabase } from './fakeSupabase'
import { checkMissedWorkouts } from '@/lib/missedWorkouts'

const USER = 'user-1'

function row(over: Partial<Record<string, any>>) {
  return {
    id: 'w1', planned_date: '2026-07-10', status: 'scheduled',
    user_id: USER, user_plan_id: null, source: 'custom',
    ...over,
  }
}

describe('checkMissedWorkouts', () => {
  const TODAY = '2026-07-20'
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T12:00:00`)) })
  afterEach(() => { jest.useRealTimers() })

  it('marks a past plan-linked or split-sourced scheduled row as missed', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [
        row({ id: 'plan-past', user_plan_id: 'p1' }),
        row({ id: 'split-past', source: 'split' }),
      ],
    })
    const n = await checkMissedWorkouts(client, USER)
    expect(n).toBe(2)
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(rows.every((r: any) => r.status === 'missed')).toBe(true)
  })

  it('never marks a custom/opportunistic session missed — only commitments', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [row({ id: 'custom-past', source: 'custom' })],
    })
    const n = await checkMissedWorkouts(client, USER)
    expect(n).toBe(0)
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(rows[0].status).toBe('scheduled')
  })

  it('never touches a future or already-completed row', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [
        row({ id: 'future', planned_date: '2026-08-01', user_plan_id: 'p1' }),
        row({ id: 'done', user_plan_id: 'p1', status: 'completed' }),
      ],
    })
    const n = await checkMissedWorkouts(client, USER)
    expect(n).toBe(0)
  })

  it('returns 0 on a query error rather than throwing (best-effort, per its own contract)', async () => {
    const client = createFakeSupabase(
      { scheduled_workouts: [row({ id: 'plan-past', user_plan_id: 'p1' })] },
      { failOps: new Set(['scheduled_workouts.update']) },
    )
    const n = await checkMissedWorkouts(client, USER)
    expect(n).toBe(0)
  })

  // Pause mode (§26, L21): pausePlan already shifts every future row past the
  // pause window before this ever runs, so this guard should never have real
  // rows to act on — but it must still refuse outright, so a stale leftover row
  // (or a sweep that races the pause write) can never get marked missed.
  it('does nothing while paused, even if a past-dated committed row somehow still exists', async () => {
    const client = createFakeSupabase({
      user_profiles: [{ user_id: USER, paused_until: '2026-07-25' }],
      scheduled_workouts: [row({ id: 'plan-past', user_plan_id: 'p1' })],
    })
    const n = await checkMissedWorkouts(client, USER)
    expect(n).toBe(0)
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(rows[0].status).toBe('scheduled')
  })

  it('resumes normal behavior once paused_until has passed', async () => {
    const client = createFakeSupabase({
      user_profiles: [{ user_id: USER, paused_until: '2026-07-15' }], // before TODAY
      scheduled_workouts: [row({ id: 'plan-past', user_plan_id: 'p1' })],
    })
    const n = await checkMissedWorkouts(client, USER)
    expect(n).toBe(1)
  })
})
