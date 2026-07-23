// Cover for generatePlan.currentWeekSlots — the mid-week signup fix.
//
// Before this existed, the plan's weekday slots were absolute (a 3-day plan is
// Mon/Wed/Fri) and any slot already past was skipped outright — the session was
// deleted, not moved. Observed on device 2026-07-22: a Wednesday-morning signup
// on a 3-day plan kept exactly ONE session, and `plan-preview`'s reveal —
// captioned "Your first week, planned." — showed five rest days and two
// workouts to someone who had just asked to train three times a week. A Sunday
// signup kept zero.
//
// These tests assert the user-facing property (how many sessions survive, and
// that they stay properly spaced) rather than exact weekday sets, so the rhythm
// heuristic can be retuned without rewriting the suite.

// generatePlan transitively imports lib/quickWorkout -> lib/moveWorkout ->
// services/calendarSync -> expo-calendar, which Jest can't parse untransformed.
// currentWeekSlots is pure and touches none of it, so stubs are safe and accurate
// (same approach as generatePlan.test.ts).
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

import { currentWeekSlots } from '@/lib/generatePlan'

const NONE = new Set<number>()
const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6, SUN = 7

/** Smallest gap between consecutive picks (Infinity for 0/1 sessions). */
const minGap = (days: number[]) =>
  days.length < 2 ? Infinity : Math.min(...days.slice(1).map((d, i) => d - days[i]))

describe('currentWeekSlots — mid-week signups keep a real week', () => {
  const THREE_DAY = [MON, WED, FRI]

  it('the observed bug: Wednesday signup, morning already gone', () => {
    // Previously kept only Friday. Must now schedule more than one session.
    const out = currentWeekSlots(THREE_DAY, WED, false, NONE)
    expect(out.length).toBeGreaterThan(1)
    for (const d of out) expect(d).toBeGreaterThan(WED) // never today or earlier
  })

  it('Sunday signup still gets a session instead of an empty week', () => {
    // Every normal slot is in the past here — this used to produce zero.
    expect(currentWeekSlots(THREE_DAY, SUN, true, NONE)).toEqual([SUN])
  })

  it('keeps rest days between sessions for a 3-day plan', () => {
    const out = currentWeekSlots(THREE_DAY, MON, false, NONE)
    expect(out.length).toBeGreaterThan(1)
    expect(minGap(out)).toBeGreaterThanOrEqual(2) // never back-to-back
  })

  it('lets a high-frequency plan stay consecutive, as its own design intends', () => {
    const fiveDay = [MON, TUE, WED, THU, FRI]
    const out = currentWeekSlots(fiveDay, WED, false, NONE)
    // A 5-day plan trains on consecutive days by construction; the mid-week
    // re-lay must not impose rest days the user never asked for.
    expect(out).toEqual([THU, FRI, SAT, SUN])
  })

  it('never schedules more sessions than the plan asks for', () => {
    // Monday, whole week ahead: a 3-day plan gets 3, not 7.
    expect(currentWeekSlots(THREE_DAY, MON, true, NONE)).toHaveLength(3)
  })

  it('never schedules more sessions than there are days left', () => {
    const out = currentWeekSlots(THREE_DAY, SAT, true, NONE)
    expect(out.length).toBeLessThanOrEqual(2) // only Sat + Sun remain
    for (const d of out) expect(d).toBeGreaterThanOrEqual(SAT)
  })

  it('respects days the user blocked off', () => {
    const blocked = new Set([SAT, SUN])
    const out = currentWeekSlots(THREE_DAY, THU, true, blocked)
    for (const d of out) expect(blocked.has(d)).toBe(false)
  })

  it('uses today when its start time is still ahead of the clock', () => {
    expect(currentWeekSlots(THREE_DAY, THU, true, NONE)[0]).toBe(THU)
  })

  it('skips today once its start time has passed', () => {
    expect(currentWeekSlots(THREE_DAY, THU, false, NONE)[0]).toBeGreaterThan(THU)
  })

  it('returns empty rather than throwing when nothing is left', () => {
    // Sunday, already past, and the week is over.
    expect(currentWeekSlots(THREE_DAY, SUN, false, NONE)).toEqual([])
    // Every remaining day blocked.
    expect(currentWeekSlots(THREE_DAY, SAT, true, new Set([SAT, SUN]))).toEqual([])
    // Degenerate plan.
    expect(currentWeekSlots([], MON, true, NONE)).toEqual([])
  })

  it('improves on the old drop-only behaviour for every weekday', () => {
    // The old code kept only the planned slots strictly after today.
    for (const today of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
      const oldKept = THREE_DAY.filter(d => d > today).length
      const now = currentWeekSlots(THREE_DAY, today, false, NONE).length
      expect(now).toBeGreaterThanOrEqual(oldKept)
    }
  })
})
