import { buildDayGaps, buildDayTimeline, resolveBounds, type TimelineItem, type TimelineWorkout } from '@/lib/dayTimeline'

const workout = (over: Partial<TimelineWorkout> = {}, hero = false): TimelineItem => ({
  kind: 'workout',
  hero,
  workout: {
    id: 'w1', focus: 'Push Day', status: 'scheduled',
    planned_start_time: '09:00:00', planned_duration_min: 45,
    ...over,
  },
})

const event = (over: Partial<{ id: string; title: string; start: Date; end: Date }> = {}): TimelineItem => ({
  kind: 'event',
  event: {
    id: 'e1', title: 'Team Standup',
    start: new Date(2026, 0, 5, 8, 0), end: new Date(2026, 0, 5, 8, 30),
    ...over,
  },
})

describe('resolveBounds', () => {
  it('defaults to a 6am–10pm window with no wake/bed set and no items', () => {
    expect(resolveBounds([], null, null)).toEqual({ startMin: 360, endMin: 1320 })
  })

  it('uses the user\'s own wake/bed time over the default', () => {
    const b = resolveBounds([], '05:00:00', '23:00:00')
    expect(b).toEqual({ startMin: 300, endMin: 1380 })
  })

  it('ignores a bedtime that is not actually after the wake time (bad data) and falls back to the default end', () => {
    const b = resolveBounds([], '07:00:00', '06:00:00')
    expect(b.endMin).toBe(1320) // default end, not the nonsensical 360
  })

  it('widens the window to include an item that would otherwise be clipped', () => {
    const early = workout({ planned_start_time: '05:00:00', planned_duration_min: 30 })
    const late = event({ start: new Date(2026, 0, 5, 23, 0), end: new Date(2026, 0, 5, 23, 45) })
    const b = resolveBounds([early, late], null, null)
    expect(b.startMin).toBeLessThanOrEqual(300)  // 5am
    expect(b.endMin).toBeGreaterThanOrEqual(1425) // 11:45pm
  })

  it('never returns a window smaller than 1 hour even with degenerate wake/bed input', () => {
    const b = resolveBounds([], '12:00:00', '12:00:00')
    expect(b.endMin - b.startMin).toBeGreaterThanOrEqual(60)
  })
})

describe('buildDayTimeline', () => {
  const bounds = { startMin: 6 * 60, endMin: 22 * 60 } // 6am–10pm, 960-minute span

  it('returns an empty layout for an empty day', () => {
    expect(buildDayTimeline([], bounds)).toEqual([])
  })

  it('positions a single workout proportionally within the window', () => {
    const items = [workout({ planned_start_time: '09:00:00', planned_duration_min: 45 })]
    const [block] = buildDayTimeline(items, bounds)
    // 9am is 180min into a 6am-start, 960min window -> 18.75%
    expect(block.topPct).toBeCloseTo(18.75, 1)
    expect(block.heightPct).toBeCloseTo((45 / 960) * 100, 1)
    expect(block.lane).toBe(0)
    expect(block.laneCount).toBe(1)
  })

  it('preserves the hero flag through layout untouched', () => {
    const items = [workout({}, true)]
    const [block] = buildDayTimeline(items, bounds)
    expect(block.item.kind).toBe('workout')
    expect(block.item.kind === 'workout' && block.item.hero).toBe(true)
  })

  it('gives non-overlapping items full width (lane 0 of 1)', () => {
    const items = [
      event({ start: new Date(2026, 0, 5, 8, 0), end: new Date(2026, 0, 5, 8, 30) }),
      workout({ planned_start_time: '10:00:00', planned_duration_min: 45 }),
    ]
    const blocks = buildDayTimeline(items, bounds)
    expect(blocks.every((b) => b.laneCount === 1 && b.lane === 0)).toBe(true)
  })

  it('assigns separate lanes to two genuinely overlapping items, without touching an unrelated third item', () => {
    const items = [
      event({ id: 'a', start: new Date(2026, 0, 5, 9, 0), end: new Date(2026, 0, 5, 10, 0) }),
      event({ id: 'b', start: new Date(2026, 0, 5, 9, 30), end: new Date(2026, 0, 5, 10, 30) }),
      workout({ planned_start_time: '14:00:00', planned_duration_min: 30 }), // unrelated, later
    ]
    const blocks = buildDayTimeline(items, bounds)
    const [a, b, later] = blocks
    expect(a.laneCount).toBe(2)
    expect(b.laneCount).toBe(2)
    expect(a.lane).not.toBe(b.lane)
    expect(later.laneCount).toBe(1) // not dragged into the overlap cluster
  })

  it('clamps an item to the window rather than producing a negative or out-of-range position', () => {
    // Starts before the 6am window opens.
    const items = [workout({ planned_start_time: '05:00:00', planned_duration_min: 30 })]
    const [block] = buildDayTimeline(items, bounds)
    expect(block.topPct).toBeGreaterThanOrEqual(0)
    expect(block.topPct).toBeLessThanOrEqual(100)
  })

  it('handles a workout longer than the whole visible window without a >100% height', () => {
    const items = [workout({ planned_start_time: '07:00:00', planned_duration_min: 2000 })]
    const [block] = buildDayTimeline(items, bounds)
    expect(block.heightPct).toBeLessThanOrEqual(100)
  })

  it('handles an event that runs past midnight (end minutes exceed 1440) by clamping to the window end', () => {
    const items = [event({
      start: new Date(2026, 0, 5, 23, 30),
      end: new Date(2026, 0, 6, 0, 30), // ends the next calendar day
    })]
    const wideBounds = { startMin: 6 * 60, endMin: 24 * 60 }
    const [block] = buildDayTimeline(items, wideBounds)
    expect(block.heightPct).toBeGreaterThan(0)
    expect(block.topPct + block.heightPct).toBeLessThanOrEqual(100.001)
  })

  it('preserves input order in the output', () => {
    const items = [
      workout({ id: 'first', planned_start_time: '18:00:00' }),
      event({ id: 'second', start: new Date(2026, 0, 5, 7, 0), end: new Date(2026, 0, 5, 7, 30) }),
    ]
    const blocks = buildDayTimeline(items, bounds)
    expect(blocks[0].item).toBe(items[0])
    expect(blocks[1].item).toBe(items[1])
  })
})

describe('buildDayGaps', () => {
  it('returns no gaps for an empty day or a single item', () => {
    expect(buildDayGaps([])).toEqual([])
    expect(buildDayGaps([event({ start: new Date(2026, 0, 5, 8, 0), end: new Date(2026, 0, 5, 8, 30) })])).toEqual([])
  })

  it('finds a real gap between two items', () => {
    const items = [
      event({ start: new Date(2026, 0, 5, 8, 0), end: new Date(2026, 0, 5, 8, 30) }),
      workout({ planned_start_time: '10:00:00', planned_duration_min: 45 }), // 90-min gap
    ]
    const gaps = buildDayGaps(items)
    expect(gaps).toEqual([{ startMin: 510, endMin: 600, beforeIndex: 1 }]) // 8:30am-10:00am
  })

  it('drops a gap shorter than the minimum meaningful length', () => {
    const items = [
      event({ start: new Date(2026, 0, 5, 8, 0), end: new Date(2026, 0, 5, 8, 30) }),
      workout({ planned_start_time: '08:35:00', planned_duration_min: 45 }), // only 5 min gap
    ]
    expect(buildDayGaps(items)).toEqual([])
  })

  it('produces no gap for back-to-back items', () => {
    const items = [
      event({ start: new Date(2026, 0, 5, 8, 0), end: new Date(2026, 0, 5, 9, 0) }),
      workout({ planned_start_time: '09:00:00', planned_duration_min: 45 }),
    ]
    expect(buildDayGaps(items)).toEqual([])
  })

  it('an item fully nested inside an earlier item never produces a spurious gap', () => {
    const items = [
      event({ id: 'a', start: new Date(2026, 0, 5, 9, 0), end: new Date(2026, 0, 5, 11, 0) }),
      workout({ planned_start_time: '09:30:00', planned_duration_min: 30 }), // fully inside the event
      event({ id: 'b', start: new Date(2026, 0, 5, 11, 15), end: new Date(2026, 0, 5, 11, 45) }), // 15-min gap: under threshold
    ]
    expect(buildDayGaps(items)).toEqual([])
  })

  it('finds only the gap after the overlap cluster ends, not a false one mid-overlap', () => {
    const items = [
      event({ id: 'a', start: new Date(2026, 0, 5, 9, 0), end: new Date(2026, 0, 5, 11, 0) }),
      workout({ planned_start_time: '09:30:00', planned_duration_min: 30 }), // fully inside the event
      event({ id: 'b', start: new Date(2026, 0, 5, 11, 45), end: new Date(2026, 0, 5, 12, 0) }), // 45-min gap after
    ]
    const gaps = buildDayGaps(items)
    expect(gaps).toEqual([{ startMin: 660, endMin: 705, beforeIndex: 2 }]) // 11:00am-11:45am
  })

  it('multiple gaps in one day all report the correct beforeIndex', () => {
    const items = [
      workout({ planned_start_time: '07:00:00', planned_duration_min: 30 }), // ends 7:30
      event({ start: new Date(2026, 0, 5, 9, 0), end: new Date(2026, 0, 5, 9, 30) }), // gap 7:30-9:00
      event({ id: 'e2', start: new Date(2026, 0, 5, 12, 0), end: new Date(2026, 0, 5, 12, 30) }), // gap 9:30-12:00
    ]
    const gaps = buildDayGaps(items)
    expect(gaps).toEqual([
      { startMin: 450, endMin: 540, beforeIndex: 1 },
      { startMin: 570, endMin: 720, beforeIndex: 2 },
    ])
  })
})
