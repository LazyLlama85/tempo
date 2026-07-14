import {
  freeWindows,
  overlapWindows,
  suggestSharedSlots,
  minutesToLabel,
  minutesToTime,
  isoWeekday,
  type AvailabilityInputs,
  type BusySlot,
} from '../availability'

const MON = '2026-07-13' // ISO weekday 1
const TUE = '2026-07-14' // ISO weekday 2

describe('helpers', () => {
  it('isoWeekday: Mon=1, Tue=2, Sun=7', () => {
    expect(isoWeekday('2026-07-13')).toBe(1)
    expect(isoWeekday('2026-07-14')).toBe(2)
    expect(isoWeekday('2026-07-19')).toBe(7)
  })
  it('minute formatting', () => {
    expect(minutesToLabel(18 * 60)).toBe('6:00 PM')
    expect(minutesToLabel(6 * 60 + 30)).toBe('6:30 AM')
    expect(minutesToTime(18 * 60 + 30)).toBe('18:30:00')
  })
})

describe('freeWindows', () => {
  const av: AvailabilityInputs = { wake_time: '06:30', bedtime: '22:30', work_start: '09:00', work_end: '17:00' }

  it('splits the day around work into morning + evening', () => {
    const w = freeWindows(av, [], [TUE])
    expect(w).toEqual([
      { date: TUE, startMin: 390, endMin: 540 }, // 06:30–09:00
      { date: TUE, startMin: 1020, endMin: 1350 }, // 17:00–22:30
    ])
  })

  it('respects training_days (no windows on a non-training day)', () => {
    const w = freeWindows({ ...av, training_days: [1, 3, 5] }, [], [TUE]) // Tue not in set
    expect(w).toEqual([])
    const wMon = freeWindows({ ...av, training_days: [1, 3, 5] }, [], [MON])
    expect(wMon.length).toBeGreaterThan(0)
  })

  it('subtracts already-scheduled workouts (busy)', () => {
    const busy: BusySlot[] = [{ date: TUE, start: '18:00', duration_min: 60 }]
    const w = freeWindows(av, busy, [TUE])
    // Evening window 17:00–22:30 is split by the 18:00–19:00 workout.
    expect(w).toContainEqual({ date: TUE, startMin: 1020, endMin: 1080 }) // 17:00–18:00
    expect(w).toContainEqual({ date: TUE, startMin: 1140, endMin: 1350 }) // 19:00–22:30
  })

  it('removes all-day unavailable blocks', () => {
    const w = freeWindows({ ...av, unavailable_blocks: [{ scope: 'date', date: TUE, allDay: true }] }, [], [TUE])
    expect(w).toEqual([])
  })
})

describe('overlap + suggestions', () => {
  it('finds a common evening window and suggests a start time', () => {
    // A free 17:00–22:30; B free 18:00–20:00.
    const a = [{ date: TUE, startMin: 1020, endMin: 1350 }]
    const b = [{ date: TUE, startMin: 1080, endMin: 1200 }]
    const overlap = overlapWindows(a, b, 60)
    expect(overlap).toEqual([{ date: TUE, startMin: 1080, endMin: 1200 }]) // 18:00–20:00

    const slots = suggestSharedSlots(overlap, 60, { preferredTimeOfDay: 'evening' })
    expect(slots).toHaveLength(1)
    expect(slots[0]).toMatchObject({ date: TUE, startMin: 1080, endMin: 1140 }) // 6:00–7:00 PM
    expect(slots[0].label).toBe('6:00 PM')
  })

  it('no overlap when free windows do not intersect for the duration', () => {
    const a = [{ date: TUE, startMin: 600, endMin: 660 }] // 10:00–11:00
    const b = [{ date: TUE, startMin: 1080, endMin: 1200 }] // 18:00–20:00
    expect(overlapWindows(a, b, 60)).toEqual([])
  })

  it('end-to-end: two schedules yield shared evening slots', () => {
    const jacob: AvailabilityInputs = { wake_time: '06:00', bedtime: '23:00', work_start: '09:00', work_end: '17:00' }
    const alex: AvailabilityInputs = { wake_time: '07:00', bedtime: '22:00', work_start: '08:00', work_end: '18:00' }
    const mine = freeWindows(jacob, [], [TUE])
    const theirs = freeWindows(alex, [], [TUE])
    const slots = suggestSharedSlots(overlapWindows(mine, theirs, 60), 60, { preferredTimeOfDay: 'evening' })
    expect(slots.length).toBeGreaterThan(0)
    // They're both free early (7–8 AM before work) AND in the evening (after Alex's
    // 18:00) — an evening option must be among the suggestions.
    expect(slots.some((s) => s.startMin >= 18 * 60)).toBe(true)
  })
})
