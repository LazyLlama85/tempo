// Tempo — autoSchedule.ts coverage (LAUNCH_SCORE_PLAN.md follow-up: this was the
// one sibling of generatePlan.ts/adaptation.ts still without a test file, named
// as a real, still-open gap when Reliability was re-verified 2026-07-23).
//
// Scope, deliberately: `autoSchedulingEnabled` (pure) and `findCalendarConflicts`
// (the free, read-only conflict detector) — both testable against the existing
// `createFakeSupabase` fake plus one jest.mock for the calendar-service call
// that does real device/network IO. `autoScheduleUpcoming` and
// `resolveCalendarConflicts` reach Google/device calendar services AND write —
// testing those meaningfully needs mocking five-plus external modules for
// marginal additional confidence over what `findCalendarConflicts` already
// locks (the same overlap-math core, minus the write). Not attempted here —
// a bigger mock than a test actually needs is exactly the kind of
// unrequested abstraction CLAUDE.md's guardrails warn against; extend this
// file if `autoScheduleUpcoming` itself needs dedicated coverage later.

// autoSchedule.ts imports several native-module-backed services at the top of
// the file (expo-calendar via calendarService.ts, transitively via
// moveWorkout.ts's calendarSync/notifications too) that Jest can't transform.
// findCalendarConflicts itself never calls any of these — they're only used by
// autoScheduleUpcoming/resolveCalendarConflicts — so mocking them to inert
// stubs is safe: their real behavior is irrelevant to what's under test here,
// only their ability to load without pulling in native code.
jest.mock('@/services/calendarSync', () => ({ getCalendarEventsForRange: jest.fn() }))
jest.mock('@/services/calendarService', () => ({ getBusyBlocks: jest.fn(), getCalendarPermissionStatus: jest.fn() }))
jest.mock('@/services/googleCalendar/CalendarAuthService', () => ({ isGoogleCalendarConnected: jest.fn() }))
jest.mock('@/services/googleCalendar/CalendarApiService', () => ({ fetchUserBusySlots: jest.fn() }))
jest.mock('@/lib/notifications', () => ({
  scheduleWorkoutReminders: jest.fn(), cancelWorkoutReminder: jest.fn(), hasReminderPermission: jest.fn(),
}))
// Same convention adaptation.test.ts/generatePlan.test.ts already use — crashReporting.ts
// pulls in react-native/expo-constants/@sentry, none of which Jest can transform.
jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn() }))

import { createFakeSupabase } from './fakeSupabase'
import { autoSchedulingEnabled, findCalendarConflicts } from '@/lib/autoSchedule'
import type { DayEvent } from '@/services/calendarService'
import { getCalendarEventsForRange } from '@/services/calendarSync'
import { isGoogleCalendarConnected } from '@/services/googleCalendar/CalendarAuthService'
import { fetchUserBusySlots } from '@/services/googleCalendar/CalendarApiService'
const mockGetEvents = getCalendarEventsForRange as jest.Mock
const mockGoogleConnected = isGoogleCalendarConnected as jest.Mock
const mockBusySlots = fetchUserBusySlots as jest.Mock

const USER = 'user-1'
const TODAY = '2026-07-20' // a Monday

function profile(over: Partial<Record<string, any>> = {}) {
  return { user_id: USER, scheduling_mode: 'auto', selected_google_calendar_ids: null, ignored_events: [], ...over }
}
function workout(over: Partial<Record<string, any>>) {
  return {
    id: 'w1', user_id: USER, status: 'scheduled', focus: 'Upper',
    planned_date: '2026-07-21', planned_start_time: '18:00:00', planned_duration_min: 60,
    calendar_event_id: null, calendar_provider: null,
    ...over,
  }
}
function event(over: Partial<DayEvent>): DayEvent {
  return { id: 'e1', title: 'Busy', start: new Date('2026-07-21T18:00:00'), end: new Date('2026-07-21T19:00:00'), ...over }
}

describe('autoSchedulingEnabled', () => {
  it('defaults to enabled when scheduling_mode is absent, null, or unknown', () => {
    expect(autoSchedulingEnabled(null)).toBe(true)
    expect(autoSchedulingEnabled(undefined)).toBe(true)
    expect(autoSchedulingEnabled({})).toBe(true)
    expect(autoSchedulingEnabled({ scheduling_mode: 'auto' })).toBe(true)
  })

  it('is disabled only for the literal "manual" value', () => {
    expect(autoSchedulingEnabled({ scheduling_mode: 'manual' })).toBe(false)
  })
})

describe('findCalendarConflicts', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T09:00:00`))
    mockGetEvents.mockReset()
    mockGoogleConnected.mockReset().mockResolvedValue(false)
    mockBusySlots.mockReset().mockResolvedValue([])
  })
  afterEach(() => { jest.useRealTimers() })

  it('flags a workout that overlaps a real calendar event', async () => {
    mockGetEvents.mockResolvedValue([event({})])
    const client = createFakeSupabase({
      user_profiles: [profile()],
      scheduled_workouts: [workout({})],
    })
    const conflicts = await findCalendarConflicts(client, USER)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ workoutId: 'w1', eventTitle: 'Busy' })
  })

  it('does not flag a workout with no overlapping event', async () => {
    mockGetEvents.mockResolvedValue([event({ start: new Date('2026-07-21T06:00:00'), end: new Date('2026-07-21T07:00:00') })])
    const client = createFakeSupabase({
      user_profiles: [profile()],
      scheduled_workouts: [workout({})],
    })
    expect(await findCalendarConflicts(client, USER)).toEqual([])
  })

  it('excludes an event the user already dismissed as ignored', async () => {
    const conflictEvent = event({})
    mockGetEvents.mockResolvedValue([conflictEvent])
    const client = createFakeSupabase({
      // Same key math as lib/ignoredEvents.eventKey — round(ms/60000).
      user_profiles: [profile({ ignored_events: [`${Math.round(conflictEvent.start.getTime() / 60000)}-${Math.round(conflictEvent.end.getTime() / 60000)}`] })],
      scheduled_workouts: [workout({})],
    })
    expect(await findCalendarConflicts(client, USER)).toEqual([])
  })

  it('never flags anything for a manual-scheduling user', async () => {
    mockGetEvents.mockResolvedValue([event({})])
    const client = createFakeSupabase({
      user_profiles: [profile({ scheduling_mode: 'manual' })],
      scheduled_workouts: [workout({})],
    })
    expect(await findCalendarConflicts(client, USER)).toEqual([])
    // The manual-mode short-circuit returns before ever reading the calendar.
    expect(mockGetEvents).not.toHaveBeenCalled()
  })

  it('degrades to no conflicts (not a crash or a false positive) when the calendar read fails', async () => {
    mockGetEvents.mockRejectedValue(new Error('network down'))
    const client = createFakeSupabase({
      user_profiles: [profile()],
      scheduled_workouts: [workout({})],
    })
    expect(await findCalendarConflicts(client, USER)).toEqual([])
  })

  it('returns nothing for a user with no upcoming scheduled workouts', async () => {
    mockGetEvents.mockResolvedValue([event({})])
    const client = createFakeSupabase({ user_profiles: [profile()], scheduled_workouts: [] })
    expect(await findCalendarConflicts(client, USER)).toEqual([])
  })

  it('flags a workout that falls inside an all-day event — fixed 2026-08-02, previously invisible here', async () => {
    // getCalendarEventsForRange (titled events) deliberately excludes all-day
    // events, so this conflict can ONLY come from the gatherBusy fallback added
    // in this fix — same source resolveCalendarConflicts (Pro) already used to
    // silently re-slot around all-day events like vacations/flights/OOO.
    mockGetEvents.mockResolvedValue([]) // no titled/timed events at all
    mockGoogleConnected.mockResolvedValue(true)
    mockBusySlots.mockResolvedValue([
      { start: new Date('2026-07-21T00:00:00'), end: new Date('2026-07-22T00:00:00') }, // full-day
    ])
    const client = createFakeSupabase({
      user_profiles: [profile()],
      scheduled_workouts: [workout({})], // 2026-07-21 18:00-19:00
    })
    const conflicts = await findCalendarConflicts(client, USER)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ workoutId: 'w1', eventTitle: null })
  })

  it('does not flag a workout against a long-but-not-all-day busy block (under the 20h threshold)', async () => {
    mockGetEvents.mockResolvedValue([])
    mockGoogleConnected.mockResolvedValue(true)
    mockBusySlots.mockResolvedValue([
      { start: new Date('2026-07-21T08:00:00'), end: new Date('2026-07-21T20:00:00') }, // 12h, not all-day
    ])
    const client = createFakeSupabase({
      user_profiles: [profile()],
      scheduled_workouts: [workout({})],
    })
    expect(await findCalendarConflicts(client, USER)).toEqual([])
  })

  it('ignores a completed/skipped workout even if it would otherwise overlap', async () => {
    mockGetEvents.mockResolvedValue([event({})])
    const client = createFakeSupabase({
      user_profiles: [profile()],
      scheduled_workouts: [workout({ status: 'completed' })],
    })
    expect(await findCalendarConflicts(client, USER)).toEqual([])
  })
})
