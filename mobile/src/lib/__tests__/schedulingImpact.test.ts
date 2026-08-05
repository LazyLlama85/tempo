import { summarizeSchedulingImpact, TEMPO_SCHEDULED_SOURCES } from '@/lib/schedulingImpact'

// A fixed week anchor keeps the "this week" assertions deterministic.
const WEEK = '2026-07-13' // a Monday

describe('summarizeSchedulingImpact', () => {
  it('counts only completed Tempo-authored sessions', () => {
    const r = summarizeSchedulingImpact([
      { planned_date: '2026-07-14', status: 'completed', source: 'plan' },
      { planned_date: '2026-07-15', status: 'completed', source: 'quick' },
      { planned_date: '2026-07-16', status: 'completed', source: 'smart' },
    ], WEEK)
    expect(r.scheduledByTempo).toBe(3)
    expect(r.thisWeek).toBe(3)
  })

  it('excludes the user\'s own planning (custom + split)', () => {
    const r = summarizeSchedulingImpact([
      { planned_date: '2026-07-14', status: 'completed', source: 'custom' },
      { planned_date: '2026-07-14', status: 'completed', source: 'split' },
      { planned_date: '2026-07-14', status: 'completed', source: 'plan' },
    ], WEEK)
    expect(r.scheduledByTempo).toBe(1)
  })

  it('excludes sessions that were not completed', () => {
    const r = summarizeSchedulingImpact([
      { planned_date: '2026-07-14', status: 'scheduled', source: 'plan' },
      { planned_date: '2026-07-14', status: 'missed', source: 'plan' },
      { planned_date: '2026-07-14', status: 'rescheduled', source: 'plan' },
      { planned_date: '2026-07-14', status: 'completed', source: 'plan' },
    ], WEEK)
    expect(r.scheduledByTempo).toBe(1)
    expect(r.thisWeek).toBe(1)
  })

  it('separates all-time from this-week by the Monday anchor', () => {
    const r = summarizeSchedulingImpact([
      { planned_date: '2026-07-06', status: 'completed', source: 'plan' }, // last week
      { planned_date: '2026-07-12', status: 'completed', source: 'plan' }, // Sun before the anchor
      { planned_date: '2026-07-13', status: 'completed', source: 'plan' }, // the anchor Monday
      { planned_date: '2026-07-17', status: 'completed', source: 'plan' }, // this week
    ], WEEK)
    expect(r.scheduledByTempo).toBe(4)
    expect(r.thisWeek).toBe(2)
  })

  it('handles null/unknown source and empty input safely', () => {
    expect(summarizeSchedulingImpact([], WEEK)).toEqual({ scheduledByTempo: 0, thisWeek: 0 })
    const r = summarizeSchedulingImpact([
      { planned_date: '2026-07-14', status: 'completed', source: null },
      { planned_date: '2026-07-14', status: 'completed', source: 'imported' },
    ], WEEK)
    expect(r.scheduledByTempo).toBe(0)
  })

  it('keeps the Tempo-source list to generated + auto-placed kinds', () => {
    expect([...TEMPO_SCHEDULED_SOURCES].sort()).toEqual(['plan', 'quick', 'smart'])
  })

  it('bounds "thisWeek" above too when weekEnd is given (Weekly Report\'s last-completed-week framing)', () => {
    const LAST_WEEK_START = '2026-07-06'
    const THIS_WEEK_START = '2026-07-13'
    const r = summarizeSchedulingImpact([
      { planned_date: '2026-06-29', status: 'completed', source: 'plan' }, // 2 weeks ago
      { planned_date: '2026-07-08', status: 'completed', source: 'plan' }, // last week
      { planned_date: '2026-07-12', status: 'completed', source: 'plan' }, // last week (Sun)
      { planned_date: '2026-07-13', status: 'completed', source: 'plan' }, // this week — must be excluded
      { planned_date: '2026-07-17', status: 'completed', source: 'plan' }, // this week — must be excluded
    ], LAST_WEEK_START, THIS_WEEK_START)
    expect(r.scheduledByTempo).toBe(5)
    expect(r.thisWeek).toBe(2)
  })

  it('omitting weekEnd stays open-ended (the default/Progress-tab live-week behavior)', () => {
    const r = summarizeSchedulingImpact([
      { planned_date: '2026-07-14', status: 'completed', source: 'plan' },
      { planned_date: '2026-12-31', status: 'completed', source: 'plan' },
    ], WEEK)
    expect(r.thisWeek).toBe(2)
  })
})
