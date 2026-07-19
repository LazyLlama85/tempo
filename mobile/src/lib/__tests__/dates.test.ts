import { todayStr, toDateStr, addDays, daysBetween, atMinute } from '@/lib/dates'

describe('dates — shared local-date utilities (C1)', () => {
  it('toDateStr formats a Date as local YYYY-MM-DD', () => {
    expect(toDateStr(new Date(2026, 6, 19))).toBe('2026-07-19') // months are 0-indexed
    expect(toDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('todayStr defaults to now and matches toDateStr(new Date())', () => {
    expect(todayStr()).toBe(toDateStr(new Date()))
  })

  it('addDays moves forward and backward across a month boundary', () => {
    expect(addDays('2026-07-30', 3)).toBe('2026-08-02')
    expect(addDays('2026-08-02', -3)).toBe('2026-07-30')
    expect(addDays('2026-07-19', 0)).toBe('2026-07-19')
  })

  it('daysBetween counts whole days, both directions', () => {
    expect(daysBetween('2026-07-19', '2026-07-26')).toBe(7)
    expect(daysBetween('2026-07-26', '2026-07-19')).toBe(-7)
    expect(daysBetween('2026-07-19', '2026-07-19')).toBe(0)
  })

  it('daysBetween is DST-safe across the US spring-forward transition (2026-03-08)', () => {
    // A naive (b - a) / 86_400_000 on raw epoch ms would compute 0.958333...
    // days across a 23-hour DST day and round to the wrong value in some
    // callers; going through local-midnight Date construction must still
    // read exactly 1.
    expect(daysBetween('2026-03-07', '2026-03-08')).toBe(1)
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1)
  })

  it('daysBetween is DST-safe across the US fall-back transition (2026-11-01)', () => {
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1)
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1)
  })

  it('atMinute builds a Date at the given minute-of-day, unaffected by DST', () => {
    // 8:00 AM = 480 minutes past midnight, on both a normal day and each side
    // of a DST transition.
    const normal = atMinute('2026-07-19', 480)
    expect(normal.getHours()).toBe(8)
    expect(normal.getMinutes()).toBe(0)

    const springForward = atMinute('2026-03-08', 480)
    expect(springForward.getHours()).toBe(8)
    expect(springForward.getMinutes()).toBe(0)

    const fallBack = atMinute('2026-11-01', 480)
    expect(fallBack.getHours()).toBe(8)
    expect(fallBack.getMinutes()).toBe(0)
  })

  it('atMinute handles a non-round minute value correctly', () => {
    const d = atMinute('2026-07-19', 90) // 1:30 AM
    expect(d.getHours()).toBe(1)
    expect(d.getMinutes()).toBe(30)
  })
})
