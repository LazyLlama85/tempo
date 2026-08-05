import { computeMaxDelayDays, planDelayWeek, type DelayableWorkout } from '@/lib/delayWeek'
import { weekEndStr } from '@/lib/dates'

// Wed 7 Jan 2026 — week is Sun 4 Jan … Sat 10 Jan.
const TODAY = '2026-01-07'

const mk = (id: string, date: string): DelayableWorkout => ({ id, date })

describe('weekEndStr', () => {
  it('resolves the Saturday of the Sunday-start week containing a date', () => {
    expect(weekEndStr('2026-01-07')).toBe('2026-01-10') // Wed → that week's Sat
    expect(weekEndStr('2026-01-04')).toBe('2026-01-10') // Sun → same week's Sat
    expect(weekEndStr('2026-01-10')).toBe('2026-01-10') // Sat → itself
  })
})

describe('computeMaxDelayDays', () => {
  it('is the gap from the LATEST workout to the week\'s last day', () => {
    expect(computeMaxDelayDays(['2026-01-07'], TODAY)).toBe(3) // Wed → Sat is 3 days
    expect(computeMaxDelayDays(['2026-01-05', '2026-01-08'], TODAY)).toBe(2) // driven by the later one (Thu)
  })

  it('is 0 when the latest workout already sits on the week\'s last day', () => {
    expect(computeMaxDelayDays(['2026-01-10'], TODAY)).toBe(0)
  })

  it('is 0 for an empty week (nothing to delay)', () => {
    expect(computeMaxDelayDays([], TODAY)).toBe(0)
  })

  it('never goes negative even with a stale/out-of-range date', () => {
    expect(computeMaxDelayDays(['2026-01-15'], TODAY)).toBe(0)
  })
})

describe('planDelayWeek', () => {
  it('shifts every workout by the same offset, preserving relative spacing', () => {
    const out = planDelayWeek(
      [mk('a', '2026-01-05'), mk('b', '2026-01-07')],
      TODAY, 2,
    )
    expect(out.find(o => o.id === 'a')!.date).toBe('2026-01-07')
    expect(out.find(o => o.id === 'b')!.date).toBe('2026-01-09')
    expect(out.every(o => o.changed)).toBe(true)
  })

  it('never lets a shifted workout spill past this week\'s last day (per-workout clamp)', () => {
    // 'a' (Mon) safely reaches Thu with +3 (within the week); 'b' (Fri) would
    // land on Mon +3 = next week — that one must be left unchanged instead of
    // spilling over, even though 'a' in the same batch shifts fine.
    const out = planDelayWeek(
      [mk('a', '2026-01-05'), mk('b', '2026-01-09')],
      TODAY, 3,
    )
    const a = out.find(o => o.id === 'a')!
    const b = out.find(o => o.id === 'b')!
    expect(a.changed).toBe(true)
    expect(a.date).toBe('2026-01-08')
    expect(b.changed).toBe(false) // clamp kicks in — 2026-01-09 (Fri) + 3 > week end (Sat 01-10)
    expect(b.date).toBe('2026-01-09')
  })

  it('is a no-op for zero, negative, or non-finite offsets', () => {
    const workouts = [mk('a', '2026-01-05')]
    for (const offset of [0, -1, NaN, Infinity]) {
      const out = planDelayWeek(workouts, TODAY, offset)
      expect(out).toEqual([{ id: 'a', date: '2026-01-05', changed: false }])
    }
  })

  it('floors a fractional offset', () => {
    const out = planDelayWeek([mk('a', '2026-01-05')], TODAY, 1.9)
    expect(out[0].date).toBe('2026-01-06') // +1, not +2
  })

  it('handles a month rollover correctly, both within and past the week boundary', () => {
    const lateJan = '2026-01-29' // Thu — week is Sun 25 Jan … Sat 31 Jan
    const out2 = planDelayWeek([mk('a', lateJan)], lateJan, 2)
    expect(out2[0]).toEqual({ id: 'a', date: '2026-01-31', changed: true }) // stays in January, in-week

    const out3 = planDelayWeek([mk('a', lateJan)], lateJan, 3)
    expect(out3[0]).toEqual({ id: 'a', date: lateJan, changed: false }) // would be Feb 1 — clamped
  })

  it('marks a workout unchanged (not merely re-dated) when the shift lands it back on the same day', () => {
    // Defensive: an offset of 0 already covered above; this covers a shift
    // that resolves to an identical date via clamp fallback.
    const out = planDelayWeek([mk('a', '2026-01-10')], TODAY, 5) // already on week's last day
    expect(out[0]).toEqual({ id: 'a', date: '2026-01-10', changed: false })
  })
})
