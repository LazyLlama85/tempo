import { planWeekReschedule, type WeekWorkout } from '@/lib/weekReschedule'
import type { Availability, BusySlot } from '@/lib/smartSchedule'
import type { Region } from '@/lib/trainingLoad'

// Mon 5 Jan 2026, 09:00 local — a fixed anchor keeps day math deterministic.
const NOW = new Date(2026, 0, 5, 9, 0, 0)

const AVAIL: Availability = {
  wakeTime: '06:00', bedtime: '22:00',
  workStart: null, workEnd: null, schoolStart: null, schoolEnd: null,
  preferredTimeOfDay: null, trainingDays: [], unavailable: [],
}

const mk = (id: string, regions: Region[], date = '2026-03-01', startTime = '08:00:00'): WeekWorkout =>
  ({ id, regions: new Set(regions), durationMin: 60, date, startTime })

const gap = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000)

describe('planWeekReschedule', () => {
  it('spreads workouts one-per-day across distinct days', () => {
    const out = planWeekReschedule(
      [mk('a', ['push']), mk('b', ['pull']), mk('c', ['legs'])],
      [], AVAIL, [], { now: NOW },
    )
    expect(out).toHaveLength(3)
    const dates = out.map(o => o.date)
    expect(new Set(dates).size).toBe(3)          // never two on the same day
    expect(out.every(o => o.changed)).toBe(true) // all moved off their far-future slot
  })

  it('only places on allowed training days', () => {
    const out = planWeekReschedule(
      [mk('a', ['push']), mk('b', ['pull']), mk('c', ['legs'])],
      [], AVAIL, [], { now: NOW, allowDays: new Set([1, 3, 5]) }, // Mon/Wed/Fri
    )
    const allowed = new Set(['2026-01-05', '2026-01-07', '2026-01-09'])
    expect(out.map(o => o.date).every(d => allowed.has(d))).toBe(true)
    expect(new Set(out.map(o => o.date)).size).toBe(3)
  })

  it('spaces same-muscle sessions apart for recovery', () => {
    const out = planWeekReschedule(
      [mk('a', ['push']), mk('b', ['push'])],
      [], AVAIL, [], { now: NOW },
    )
    expect(Math.abs(gap(out[0].date, out[1].date))).toBeGreaterThanOrEqual(2)
  })

  it('keeps a session when its only allowed day is fully busy (never phantom-places)', () => {
    const busy: BusySlot[] = [{ start: new Date(2026, 0, 6, 0, 0, 0), end: new Date(2026, 0, 7, 0, 0, 0) }]
    const out = planWeekReschedule(
      [mk('a', ['push'], '2026-01-06', '08:00:00')],
      busy, AVAIL, [], { now: NOW, allowDays: new Set([2]) }, // Tue only, and Tue is blocked all day
    )
    expect(out).toHaveLength(1)
    expect(out[0].changed).toBe(false)
    expect(out[0].date).toBe('2026-01-06')
  })

  it('never drops a workout when the week runs out of days', () => {
    const out = planWeekReschedule(
      [mk('a', ['push']), mk('b', ['pull'])],
      [], AVAIL, [], { now: NOW, allowDays: new Set([1]) }, // Mon only → a single slot
    )
    expect(out).toHaveLength(2)
    expect(out.filter(o => !o.changed)).toHaveLength(1)  // the overflow one is kept intact
    expect(out.some(o => o.date === '2026-01-05')).toBe(true)
  })

  it('never lets a later workout leapfrog an earlier one, even when its own regions score better for an earlier day (preserves a Push/Pull/Legs-style split order — reported bug: Pull took today, Push got bumped to Saturday)', () => {
    // A push-region load 2 days before "today" penalizes today for another push
    // session but not at all for a pull session (no region overlap). Restricting
    // to Mon/Wed/Fri (a 3x/week cadence) isolates the effect cleanly: Push's own
    // best day is Wednesday; without an order constraint Pull would then find
    // MONDAY (today) scores best for it specifically and grab it out from under
    // Push — exactly the reported bug. Verified this scenario reproduces the bug
    // on the pre-fix planner before locking in the corrected behavior.
    const priorLoads = [{ date: '2026-01-03', regions: new Set<Region>(['push']) }]
    const out = planWeekReschedule(
      [mk('push', ['push'], '2026-01-05', '08:00:00'), mk('pull', ['pull'], '2026-01-07', '08:00:00')],
      [], AVAIL, priorLoads, { now: NOW, allowDays: new Set([1, 3, 5]) },
    )
    const pushDay = out.find(o => o.id === 'push')!.date
    const pullDay = out.find(o => o.id === 'pull')!.date
    expect(pushDay <= pullDay).toBe(true)
    expect(pushDay).toBe('2026-01-07') // Wed — push's genuinely best day
    expect(pullDay).toBe('2026-01-09') // Fri — deferred behind push, not Monday
  })

  it('does not re-slot a session already sitting in its optimal spot (no churn)', () => {
    // First pass decides where a lone workout lands…
    const first = planWeekReschedule([mk('a', ['push'])], [], AVAIL, [], { now: NOW })[0]
    // …feed that exact slot back in; it should register as unchanged.
    const again = planWeekReschedule(
      [mk('a', ['push'], first.date, first.start_time)],
      [], AVAIL, [], { now: NOW },
    )[0]
    expect(again.date).toBe(first.date)
    expect(again.changed).toBe(false)
  })
})
