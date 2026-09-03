// Start-time selection: the plan must not schedule a session the user cannot make.
//
// Founder report, 2026-09-02: a user entered wake 06:30 and school 07:00 and the
// plan handed them a 07:00 workout — the exact minute school starts. Plan
// generation picked purely off preferred_time_of_day from a hardcoded table and
// never looked at wake, work or school at all.

import {
  chooseSessionStart, weekdayFreeIntervals, minutesToTime, toMinutes,
  WEEKDAY_EARLIEST_MIN, WAKE_BUFFER_MIN, wakingWindow,
} from '@/lib/availability'

const MORNING = ['07:00:00', '08:00:00', '06:30:00', '07:30:00'].map(t => toMinutes(t)!)
const EVENING = ['17:30:00', '18:30:00', '19:00:00', '18:00:00'].map(t => toMinutes(t)!)
const ALL = [...MORNING, ...EVENING]

const student = { wake_time: '06:30', bedtime: '22:30', school_start: '07:00', school_end: '15:00' }
const MON = 1, SAT = 6

describe('chooseSessionStart', () => {
  it('never schedules into school (the reported bug)', () => {
    const start = chooseSessionStart({ candidates: ALL, weekday: MON, durationMin: 45, av: student })
    expect(start).not.toBeNull()
    const s = start!
    const schoolStart = toMinutes('07:00')!, schoolEnd = toMinutes('15:00')!
    // The whole session must sit outside school hours.
    expect(s >= schoolEnd || s + 45 <= schoolStart).toBe(true)
    expect(minutesToTime(s)).not.toBe('07:00:00')
  })

  it('does not squeeze a 45 minute session into a 30 minute gap before school', () => {
    // 06:30 wake to 07:00 school is 30 minutes, and that is before the buffer anyway.
    const s = chooseSessionStart({ candidates: ALL, weekday: MON, durationMin: 45, av: student })!
    expect(s).toBeGreaterThanOrEqual(toMinutes('15:00')!)
  })

  it('never starts before the user has got out of bed', () => {
    const s = chooseSessionStart({ candidates: ALL, weekday: SAT, durationMin: 45, av: student })!
    expect(s).toBeGreaterThanOrEqual(toMinutes('06:30')! + WAKE_BUFFER_MIN)
  })

  it('avoids early weekday starts when something later fits', () => {
    // Free all day, morning preference: the soft floor should push it off 06:30.
    const free = { wake_time: '05:00', bedtime: '22:30' }
    const s = chooseSessionStart({ candidates: MORNING, weekday: MON, durationMin: 45, av: free })!
    expect(s).toBeGreaterThanOrEqual(WEEKDAY_EARLIEST_MIN)
  })

  it('still allows an early weekday start when it is the only window', () => {
    // Works 09:00 to 21:00: the only gap is the early morning, so take it.
    const shift = { wake_time: '05:00', bedtime: '22:30', work_start: '09:00', work_end: '21:00' }
    const s = chooseSessionStart({ candidates: ALL, weekday: MON, durationMin: 45, av: shift })!
    expect(s + 45).toBeLessThanOrEqual(toMinutes('09:00')!)
    expect(s).toBeGreaterThanOrEqual(toMinutes('05:00')! + WAKE_BUFFER_MIN)
  })

  it('leaves weekends alone', () => {
    const free = { wake_time: '06:30', bedtime: '22:30' }
    const s = chooseSessionStart({ candidates: MORNING, weekday: SAT, durationMin: 45, av: free })!
    expect(s).toBeLessThan(WEEKDAY_EARLIEST_MIN)
  })

  it('falls back to a real window when no preferred time fits', () => {
    // Morning preference, but school owns the morning: it must land after school.
    const s = chooseSessionStart({ candidates: MORNING, weekday: MON, durationMin: 60, av: student })!
    expect(s).toBeGreaterThanOrEqual(toMinutes('15:00')!)
    expect(s + 60).toBeLessThanOrEqual(toMinutes('22:30')!)
  })

  it('returns null when the day genuinely has no room', () => {
    const packed = { wake_time: '07:00', bedtime: '22:00', work_start: '07:30', work_end: '21:59' }
    expect(chooseSessionStart({ candidates: ALL, weekday: MON, durationMin: 45, av: packed })).toBeNull()
  })

  it('respects a weekday-scoped unavailable block', () => {
    const av = {
      wake_time: '06:00', bedtime: '22:30',
      unavailable_blocks: [{ scope: 'weekday' as const, weekday: MON, start: '16:00', end: '21:00' }],
    }
    const s = chooseSessionStart({ candidates: EVENING, weekday: MON, durationMin: 45, av })!
    expect(s >= toMinutes('21:00')! || s + 45 <= toMinutes('16:00')!).toBe(true)
  })

  it('always returns a start whose whole session fits a free window', () => {
    const cases = [student, { wake_time: '05:30', bedtime: '23:00', work_start: '08:00', work_end: '17:00' }, { wake_time: '09:00', bedtime: '01:00' }]
    for (const av of cases) {
      for (let wd = 1; wd <= 7; wd++) {
        for (const dur of [30, 45, 60, 90]) {
          const s = chooseSessionStart({ candidates: ALL, weekday: wd, durationMin: dur, av })
          if (s == null) continue
          const fits = weekdayFreeIntervals(av, wd).some(([a, b]) => s >= a && s + dur <= b)
          expect(fits).toBe(true)
        }
      }
    }
  })
})

// ── Work and school are weekday commitments ────────────────────────────────────
// Found 2026-09-02 while auditing the class of bug behind the 07:00-during-school
// report: work/school hours were applied to every day of the week, so Saturday
// and Sunday 09:00–17:00 were blocked for every 9-to-5 user.
describe('weekday commitments', () => {
  const worker = { wake_time: '06:30', bedtime: '22:30', work_start: '09:00', work_end: '17:00' }
  const MON = 1, SAT = 6, SUN = 7

  it('blocks working hours on a weekday', () => {
    const free = weekdayFreeIntervals(worker, MON)
    expect(free.some(([s, e]) => s <= toMinutes('12:00')! && e > toMinutes('12:00')!)).toBe(false)
  })

  it('leaves the weekend free during those same hours', () => {
    for (const day of [SAT, SUN]) {
      const free = weekdayFreeIntervals(worker, day)
      const noon = toMinutes('12:00')!
      expect(free.some(([s, e]) => s <= noon && e >= noon + 45)).toBe(true)
    }
  })

  it('can place a Saturday midday session for a 9-to-5 user', () => {
    const s = chooseSessionStart({
      candidates: [toMinutes('12:30')!], weekday: SAT, durationMin: 45, av: worker,
    })
    expect(s).toBe(toMinutes('12:30')!)
  })

  it('still respects a weekend unavailable block', () => {
    const av = {
      ...worker,
      unavailable_blocks: [{ scope: 'weekday' as const, weekday: SAT, start: '09:00', end: '17:00' }],
    }
    const free = weekdayFreeIntervals(av, SAT)
    const noon = toMinutes('12:00')!
    expect(free.some(([s, e]) => s <= noon && e >= noon + 45)).toBe(false)
  })
})

// ── The reports from 2026-09-02, each as a test ────────────────────────────────
describe('reported cases', () => {
  const MON = 1

  it('"I said I wake up at 7:00 AM and it told me to work out at 6:30 AM"', () => {
    const av = { wake_time: '07:00', bedtime: '22:30' }
    const s = chooseSessionStart({ candidates: ALL, weekday: MON, durationMin: 45, av })!
    expect(s).toBeGreaterThanOrEqual(toMinutes('07:30')!) // wake + buffer
    expect(minutesToTime(s)).not.toBe('06:30:00')
  })

  it('"I told it the school timings and then it made a workout at like 2:30 PM"', () => {
    const av = { wake_time: '06:30', bedtime: '22:30', school_start: '08:00', school_end: '15:00' }
    const s = chooseSessionStart({ candidates: ALL, weekday: MON, durationMin: 45, av })!
    const schoolStart = toMinutes('08:00')!, schoolEnd = toMinutes('15:00')!
    expect(s >= schoolEnd || s + 45 <= schoolStart).toBe(true)
  })

  it('"I said I slept at 9:30 and it made a workout at 9:30"', () => {
    const av = { wake_time: '06:30', bedtime: '21:30' }
    const s = chooseSessionStart({ candidates: ALL, weekday: MON, durationMin: 45, av })!
    expect(s + 45).toBeLessThanOrEqual(toMinutes('21:30')!)
  })

  it('a bedtime after midnight means the evening is free, not the small hours', () => {
    // wake 07:00, bed 00:30. min/max used to make the window 00:30-07:00, i.e.
    // exactly when the user is asleep, so every slot offered was overnight.
    const av = { wake_time: '07:00', bedtime: '00:30' }
    const [start, end] = wakingWindow(av)
    expect(start).toBe(toMinutes('07:00')!)
    expect(end).toBeGreaterThan(toMinutes('22:00')!)
    const s = chooseSessionStart({ candidates: EVENING, weekday: MON, durationMin: 45, av })!
    expect(s).toBeGreaterThanOrEqual(toMinutes('07:30')!)
  })
})
