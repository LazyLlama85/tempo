// Regression coverage (B5.5 continuation) for splitSchedule.ts — the OTHER
// caller of the shared sweep (retireWorkouts.sweepScheduledPlanRows) that,
// together with generatePlan.ts, is what the audit's "poisoned Change Plan"
// bug class is about: a stranded 'scheduled' row from an old plan/split
// blocking the new schedule's insert. retireWorkouts.test.ts already locks
// the sweep itself; this locks the caller that activates a SPLIT specifically.

import { createFakeSupabase } from './fakeSupabase'
import { activateSplit, materializeSplit } from '@/lib/splitSchedule'
import type { Split, SplitDay } from '@/types'

jest.mock('@/services/calendarSync', () => ({
  removeWorkoutFromCalendar: jest.fn().mockResolvedValue(undefined),
  addWorkoutToCalendar: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/notifications', () => ({
  cancelWorkoutReminder: jest.fn().mockResolvedValue(undefined),
  scheduleWorkoutReminders: jest.fn().mockResolvedValue(undefined),
  hasReminderPermission: jest.fn().mockResolvedValue(false),
}))
jest.mock('@/services/googleCalendar/CalendarAuthService', () => ({
  isGoogleCalendarConnected: jest.fn().mockResolvedValue(false),
  getGoogleAccessToken: jest.fn().mockResolvedValue(null),
  invalidateGoogleAccessToken: jest.fn(),
}))
jest.mock('@/services/calendarService', () => ({
  getBusyBlocks: jest.fn().mockResolvedValue([]),
  getCalendarPermissionStatus: jest.fn().mockResolvedValue('denied'),
}))
jest.mock('@/lib/crashReporting', () => ({
  captureApiError: jest.fn(),
  captureException: jest.fn(),
}))

const USER = 'user-1'
const TODAY = '2026-07-20' // Monday

function splitDay(over: Partial<SplitDay>): SplitDay {
  return { weekday: 1, label: 'Push', rest: false, exercise_ids: ['ex1'], config: [], ...over }
}

function split(over: Partial<Split> = {}): Split {
  return {
    id: 'split-1', user_id: USER, name: 'My Split', is_active: false,
    kind: 'custom', created_at: TODAY, updated_at: TODAY,
    days: [1, 2, 3, 4, 5, 6, 7].map((wd) => splitDay({ weekday: wd, rest: wd > 5 })),
    ...over,
  }
}

function workoutRow(over: Partial<Record<string, any>>) {
  return {
    id: 'w1', user_id: USER, focus: 'Push', planned_date: TODAY, planned_start_time: '09:00:00',
    planned_duration_min: 45, calendar_event_id: null, calendar_provider: null,
    status: 'scheduled', user_plan_id: null, source: 'custom', split_id: null,
    ...over,
  }
}

describe('materializeSplit', () => {
  // Early morning: every START_TIMES slot (morning/afternoon/evening) is still
  // ahead of "now", so the same-day past-time guard (tested on its own below)
  // never interferes with these skip/retire assertions.
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T05:00:00`)) })
  afterEach(() => { jest.useRealTimers() })

  it('inserts a row for each non-rest weekday in the 28-day horizon, and none for rest days', async () => {
    const client = createFakeSupabase({ scheduled_workouts: [] })
    const s = split() // Sat/Sun are rest days in this fixture
    const n = await materializeSplit(client, USER, s, 'morning')
    expect(n).toBeGreaterThan(0)
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(rows.every((r: any) => r.split_id === s.id)).toBe(true)
    expect(rows.every((r: any) => r.source === 'split')).toBe(true)
    const weekdays = new Set(rows.map((r: any) => ((new Date(`${r.planned_date}T00:00:00`).getDay() + 6) % 7) + 1))
    expect(weekdays.has(6)).toBe(false)
    expect(weekdays.has(7)).toBe(false)
  })

  it('is idempotent — a date the split already owns is never duplicated on re-run', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [workoutRow({ id: 'existing', split_id: 'split-1', planned_date: TODAY })],
    })
    await materializeSplit(client, USER, split(), 'morning')
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER).eq('planned_date', TODAY)).data
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('existing')
  })

  it('skips creating TODAY\'s session when its natural slot has already passed — never surface an already-gone window as "today\'s workout"', async () => {
    jest.setSystemTime(new Date(`${TODAY}T12:00:00`)) // noon — every morning slot is behind us
    const client = createFakeSupabase({ scheduled_workouts: [] })
    await materializeSplit(client, USER, split(), 'morning')
    const todayRows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER).eq('planned_date', TODAY)).data
    expect(todayRows).toHaveLength(0)
    // Future days are unaffected — the guard only ever applies to day 0.
    const allRows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(allRows.length).toBeGreaterThan(0)
  })

  it('never materializes the auto-plan mirror (that would duplicate plan-owned sessions)', async () => {
    const client = createFakeSupabase({ scheduled_workouts: [] })
    const n = await materializeSplit(client, USER, split({ kind: 'auto' }), 'morning')
    expect(n).toBe(0)
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(rows).toHaveLength(0)
  })

  it('is a no-op when every day is rest (nothing to place)', async () => {
    const client = createFakeSupabase({ scheduled_workouts: [] })
    const allRest = split({ days: [1, 2, 3, 4, 5, 6, 7].map((wd) => splitDay({ weekday: wd, rest: true })) })
    const n = await materializeSplit(client, USER, allRest, 'morning')
    expect(n).toBe(0)
  })

  it('re-adds a day the user removed (status skipped) instead of treating it as permanently taken', async () => {
    // Regression: a skipped day used to block this fill forever — "delete a
    // workout" had no way back except adding it manually.
    const client = createFakeSupabase({
      scheduled_workouts: [workoutRow({ id: 'removed', split_id: 'split-1', planned_date: TODAY, status: 'skipped' })],
    })
    const n = await materializeSplit(client, USER, split(), 'morning')
    expect(n).toBeGreaterThan(0)
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER).eq('planned_date', TODAY)).data
    // Both rows now exist: the old skipped one (untouched, kept for history) and
    // a fresh 'scheduled' one filling the day back in.
    expect(rows.some((r: any) => r.status === 'skipped')).toBe(true)
    expect(rows.some((r: any) => r.status === 'scheduled' && r.split_id === 'split-1')).toBe(true)
  })

  it('never re-adds a day marked rescheduled — that row is genuinely superseded, not just skipped', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [workoutRow({ id: 'superseded', split_id: 'split-1', planned_date: TODAY, status: 'rescheduled' })],
    })
    await materializeSplit(client, USER, split(), 'morning')
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER).eq('planned_date', TODAY)).data
    // Still just the one row — a 'rescheduled' date reads as taken, same as before this fix.
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('superseded')
  })
})

describe('activateSplit — the poisoned-Change-Plan scenario, for splits', () => {
  // Early morning: every START_TIMES slot (morning/afternoon/evening) is still
  // ahead of "now", so the same-day past-time guard (tested on its own below)
  // never interferes with these skip/retire assertions.
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T05:00:00`)) })
  afterEach(() => { jest.useRealTimers() })

  const MANUAL = { scheduling_mode: 'manual', preferred_time_of_day: 'morning' as const }

  it('retires a stranded plan row on TODAY before materializing the new split on the same date (the exact race that used to poison Change Plan)', async () => {
    const client = createFakeSupabase({
      user_plans: [{ id: 'plan-1', user_id: USER, status: 'active' }],
      splits: [{ ...split(), is_active: false }],
      scheduled_workouts: [
        // Stranded row from the OLD plan, same date the new split will want to use.
        workoutRow({ id: 'old-plan-row', user_plan_id: 'plan-1', planned_date: TODAY, source: 'plan' }),
      ],
      workout_logs: [],
    })

    const result = await activateSplit(client, USER, split(), MANUAL)
    expect(result).toBe('activated')

    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER).eq('planned_date', TODAY)).data
    // The old plan row is gone (retired), and exactly one row — the new split's —
    // occupies today. Never both: that collision is exactly what poisoned Change Plan.
    expect(rows.find((r: any) => r.id === 'old-plan-row')).toBeUndefined()
    expect(rows.some((r: any) => r.split_id === 'split-1')).toBe(true)
  })

  it('marks the old active plan abandoned', async () => {
    const client = createFakeSupabase({
      user_plans: [{ id: 'plan-1', user_id: USER, status: 'active' }],
      splits: [{ ...split(), is_active: false }],
      scheduled_workouts: [],
      workout_logs: [],
    })
    await activateSplit(client, USER, split(), MANUAL)
    const plans = (await client.from('user_plans').select('*').eq('user_id', USER)).data
    expect(plans[0].status).toBe('abandoned')
  })

  it('deactivates a previously-active split when activating a new one', async () => {
    const client = createFakeSupabase({
      user_plans: [],
      splits: [
        { ...split({ id: 'old-split' }), is_active: true },
        { ...split({ id: 'split-1' }), is_active: false },
      ],
      scheduled_workouts: [],
      workout_logs: [],
    })
    await activateSplit(client, USER, split(), MANUAL)
    const splits = (await client.from('splits').select('*').eq('user_id', USER)).data
    const oldOne = splits.find((s: any) => s.id === 'old-split')
    const newOne = splits.find((s: any) => s.id === 'split-1')
    expect(oldOne.is_active).toBe(false)
    expect(newOne.is_active).toBe(true)
  })

  it('returns "failed" without touching the schedule when abandoning the old plan fails', async () => {
    const client = createFakeSupabase(
      {
        user_plans: [{ id: 'plan-1', user_id: USER, status: 'active' }],
        splits: [{ ...split(), is_active: false }],
        scheduled_workouts: [],
        workout_logs: [],
      },
      { failOps: new Set(['user_plans.update']) },
    )
    const result = await activateSplit(client, USER, split(), MANUAL)
    expect(result).toBe('failed')
  })
})
