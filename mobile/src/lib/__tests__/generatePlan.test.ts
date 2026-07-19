// Regression coverage for MASTER_FIX_PLAN.md F1 — the plan-cliff bug.
//
// scheduled_workouts.week_index was overloaded to mean both a mesocycle-phase
// index (periodization.ts) AND a pure date-offset from the plan's start_date
// (generatePlan.ts's rollover math). adaptation.ts's applyAdaptationMode
// re-anchors week_index on a recovery/deload transition — correct for the
// phase meaning, but it corrupts the date-offset meaning, so the NEXT
// rollover's "how many weeks in is this plan" read could return a small,
// wrong number and generate an entirely-past block (silently 0 rows — an
// empty schedule for a paying user). week_offset (add_week_offset.sql) is the
// fix: written once at insert, never rewritten by adaptation. These tests
// simulate that corruption directly (set week_index wrong, week_offset right)
// rather than invoking the full adaptation engine, to keep the fake-Supabase
// setup focused on what generatePlan.ts itself reads and writes.

import { createFakeSupabase, fakeError } from './fakeSupabase'
import { extendActivePlan } from '@/lib/generatePlan'
import { formatLocalDate } from '@/lib/planRollover'

// generatePlan.ts pulls in retireWorkouts.ts -> services/calendarSync.ts ->
// expo-calendar (a native module ts-jest's Node-oriented config can't
// transform) — neutralize the same way splitSchedule.test.ts does for the
// same reason.
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
const PLAN_ID = 'plan-1'

// A minimal but slot-complete built-in exercise pool — one per movement
// pattern generalSessions(3) needs (squat/hinge/h_push/h_pull/v_push/v_pull/
// core), named so classifyExercise's keyword rules resolve them unambiguously
// and canPerform passes for anyone (required_equipment: bodyweight, and none
// of these names trip needsApparatus's bar/dip/ring detection).
function exercisePool() {
  const ex = (id: string, name: string) => ({
    id, name, movement_pattern: 'push', experience_level: 'beginner',
    required_equipment: ['bodyweight'], primary_muscles: [], secondary_muscles: [],
    is_core: true, popularity: 50, user_id: null,
  })
  return [
    ex('squat', 'Squat'), ex('hinge', 'Deadlift'), ex('hpush', 'Bench Press'),
    ex('hpull', 'Row'), ex('vpush', 'Overhead Press'), ex('vpull', 'Cable Pulldown'),
    ex('core', 'Plank'),
  ]
}

function baseProfile() {
  return {
    user_id: USER, goal: 'general_fitness', experience: 'beginner', equipment: [],
    days_per_week: 3, preferred_duration_min: 45, preferred_time_of_day: 'morning',
    unavailable_blocks: [], training_days: [], injuries: [],
  }
}

describe('extendActivePlan — plan-cliff regression (F1)', () => {
  it('rolls over correctly using week_offset even when week_index has been corrupted by an adaptation restamp', async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const startMonday = new Date(today)
    startMonday.setDate(startMonday.getDate() - 56) // plan started 8 full weeks ago
    const planStartDateStr = formatLocalDate(startMonday)

    // The plan's last existing row: 7 days before today (inside the 7-day
    // runway, so rollover should trigger) at week_offset 7 (the TRUE "8th
    // week" this plan is in) — but week_index was corrupted to 2 by a
    // simulated recovery-mode restamp, exactly the scenario applyAdaptationMode
    // can produce.
    const lastRowDate = new Date(today)
    lastRowDate.setDate(lastRowDate.getDate() - 7)

    const tables: Record<string, any[]> = {
      user_plans: [{ id: PLAN_ID, user_id: USER, status: 'active', start_date: planStartDateStr, adaptation_mode: 'recovery' }],
      scheduled_workouts: [{
        id: 'existing-1', user_id: USER, user_plan_id: PLAN_ID,
        planned_date: formatLocalDate(lastRowDate), planned_start_time: '07:00:00',
        status: 'scheduled', source: 'plan',
        week_index: 2,      // corrupted by a simulated adaptation restamp
        week_offset: 7,     // the true, never-rewritten date offset
      }],
      user_profiles: [baseProfile()],
      exercises: exercisePool(),
    }
    const client = createFakeSupabase(tables)

    const inserted = await extendActivePlan(client, USER)

    // With the fix, weekFrom = 7 + 1 = 8, so the new block starts at
    // startMonday + 8 weeks — the same neighborhood as "today" — and rows
    // should actually land (not all be filtered out as past-dated). Before
    // the fix, weekFrom would have been 2 + 1 = 3 (read from the corrupted
    // week_index), landing the whole block ~5 weeks in the past and
    // producing zero rows — the exact bug this test guards against.
    expect(inserted).toBeGreaterThan(0)

    const newRows = tables.scheduled_workouts.filter(r => r.id !== 'existing-1')
    expect(newRows.length).toBe(inserted)
    const todayStr = formatLocalDate(today)
    for (const row of newRows) {
      expect(row.planned_date >= todayStr).toBe(true)
      // Every newly-inserted row must carry a week_offset that is never
      // re-anchored by adaptation — the whole point of the fix.
      expect(row.week_offset).toBeGreaterThanOrEqual(8)
    }
  })

  it('one stale blocking row on a single date does not void the rest of the new block', async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const startMonday = new Date(today)
    startMonday.setDate(startMonday.getDate() - 56)
    const planStartDateStr = formatLocalDate(startMonday)

    const lastRowDate = new Date(today)
    lastRowDate.setDate(lastRowDate.getDate() - 7)

    // Block a single future date the new rollover will want to use: the first
    // day of week 8 (startMonday + 56 days), already occupied by a stray
    // 'scheduled' row from a stale plan (the exact partial-unique-index
    // collision that used to void the ENTIRE bulk insert).
    const blockedDate = new Date(startMonday)
    blockedDate.setDate(blockedDate.getDate() + 56)

    const tables: Record<string, any[]> = {
      user_plans: [{ id: PLAN_ID, user_id: USER, status: 'active', start_date: planStartDateStr, adaptation_mode: 'normal' }],
      scheduled_workouts: [
        {
          id: 'existing-1', user_id: USER, user_plan_id: PLAN_ID,
          planned_date: formatLocalDate(lastRowDate), planned_start_time: '07:00:00',
          status: 'scheduled', source: 'plan', week_index: 7, week_offset: 7,
        },
        {
          id: 'stale-blocker', user_id: USER, user_plan_id: 'some-other-plan',
          planned_date: formatLocalDate(blockedDate), planned_start_time: '07:00:00',
          status: 'scheduled', source: 'plan', week_index: 0, week_offset: 0,
        },
      ],
      user_profiles: [baseProfile()],
      exercises: exercisePool(),
    }
    // Force exactly one insert (the row landing on blockedDate) to fail, the
    // way a real unique-index violation would — the fake fails by op kind per
    // table, not per row, so this test proves the LOOP keeps going after a
    // per-row failure rather than proving a real Postgres 23505 specifically;
    // extendActivePlan's per-row (not bulk) insert is what makes that safe.
    let insertCount = 0
    const client = createFakeSupabase(tables)
    const realFrom = client.from.bind(client)
    client.from = (table: string) => {
      const builder = realFrom(table)
      if (table !== 'scheduled_workouts') return builder
      const realInsert = builder.insert.bind(builder)
      builder.insert = (row: any) => {
        insertCount++
        if (insertCount === 1) {
          // Simulate the first attempted insert colliding with the stale
          // blocker row (a real unique-violation would look like this).
          const failing = realInsert(row)
          failing.then = (resolve: any) => resolve({ data: null, error: fakeError('duplicate key value violates unique constraint') })
          return failing
        }
        return realInsert(row)
      }
      return builder
    }

    const inserted = await extendActivePlan(client, USER)

    // Exactly one attempted insert was forced to fail; every other attempted
    // row must still have landed — a single collision no longer voids the
    // whole block the way one bulk .insert(rows) used to.
    expect(insertCount).toBeGreaterThan(1)
    expect(inserted).toBe(insertCount - 1)
  })
})
