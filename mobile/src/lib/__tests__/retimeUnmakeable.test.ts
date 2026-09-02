// The repair sweep for sessions already scheduled at an impossible time.
// It must fix the reported shape (07:00 when school starts at 07:00) and, just
// as importantly, must NOT rearrange a week the user is happy with.

jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn() }))

import { isUnmakeable, type RetimeRow } from '@/lib/retimeUnmakeable'

const student = { wake_time: '06:30', bedtime: '22:30', school_start: '07:00', school_end: '15:00' }
// 2026-09-07 is a Monday, 2026-09-12 a Saturday.
const MON = '2026-09-07', SAT = '2026-09-12'
const row = (over: Partial<RetimeRow> = {}): RetimeRow => ({
  id: 'w1', planned_date: MON, planned_start_time: '17:30:00', planned_duration_min: 45, ...over,
})

describe('isUnmakeable', () => {
  it('flags the reported case: 07:00 on a day school starts at 07:00', () => {
    expect(isUnmakeable(row({ planned_start_time: '07:00:00' }), student)).toBe(true)
  })

  it('flags a session that starts before the user is out of bed', () => {
    expect(isUnmakeable(row({ planned_start_time: '06:30:00' }), student)).toBe(true)
    expect(isUnmakeable(row({ planned_start_time: '06:45:00' }), student)).toBe(true)
  })

  it('flags a session that starts in a gap but overruns into school', () => {
    // Hypothetical later school start: 06:30 + 45min would run past 07:00.
    const av = { ...student, wake_time: '05:00' }
    expect(isUnmakeable(row({ planned_start_time: '06:30:00' }), av)).toBe(true)
  })

  it('leaves a perfectly makeable session alone', () => {
    expect(isUnmakeable(row({ planned_start_time: '17:30:00' }), student)).toBe(false)
    expect(isUnmakeable(row({ planned_start_time: '15:30:00' }), student)).toBe(false)
  })

  it('does not touch an early weekend session', () => {
    // The weekday-early preference is for the SCHEDULER, not a reason to move
    // something the user already has. Saturday 07:30 is fine.
    expect(isUnmakeable(row({ planned_date: SAT, planned_start_time: '07:30:00' }), student)).toBe(false)
  })

  it('does not move a merely-early weekday session that is genuinely free', () => {
    // No school, no work, awake since 05:00: 07:00 is early but entirely possible,
    // so the sweep must leave it. Silently rearranging a chosen time is its own bug.
    const av = { wake_time: '05:00', bedtime: '22:30' }
    expect(isUnmakeable(row({ planned_start_time: '07:00:00' }), av)).toBe(false)
  })

  it('says nothing when the user has told us nothing about the day', () => {
    expect(isUnmakeable(row({ planned_start_time: '03:00:00' }), {})).toBe(false)
  })

  it('flags a session inside working hours', () => {
    const worker = { wake_time: '06:30', bedtime: '23:00', work_start: '09:00', work_end: '17:00' }
    expect(isUnmakeable(row({ planned_start_time: '12:30:00' }), worker)).toBe(true)
    expect(isUnmakeable(row({ planned_start_time: '18:00:00' }), worker)).toBe(false)
  })

  it('flags a session running past bedtime', () => {
    expect(isUnmakeable(row({ planned_start_time: '22:15:00', planned_duration_min: 60 }), student)).toBe(true)
  })

  it('treats a missing duration as 45 minutes rather than skipping the check', () => {
    expect(isUnmakeable(row({ planned_start_time: '07:00:00', planned_duration_min: null }), student)).toBe(true)
  })
})
