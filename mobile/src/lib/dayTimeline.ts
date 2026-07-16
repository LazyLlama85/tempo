// Tempo — the day-timeline hero (Home redesign, Part 1 of the plan approved
// 2026-07-16): turns today's already-merged, already-sorted workout+event feed
// into a proportional layout a calendar-style ruler can render — "your real
// calendar gaps with the Tempo workout dropped in place."
//
// Pure, no I/O → unit-testable. Deliberately does NOT re-fetch or re-merge
// anything: Home's existing `dayGroups` (index.tsx) already does the real work
// (unifying device + Google + Tempo workouts, sorted, with the hero workout
// already picked) — this module only adds the LAYOUT MATH that was missing.
// Types here are intentionally independent of index.tsx's screen-local
// `ScheduledWorkout`/`FeedItem` (a lib module importing from an app screen
// would be backwards) — they're structurally compatible, so index.tsx's real
// objects pass in unchanged.

export interface TimelineWorkout {
  id: string
  focus: string
  status: string
  planned_start_time: string   // 'HH:MM:SS'
  planned_duration_min: number
}

export interface TimelineEvent {
  id: string
  title: string
  start: Date
  end: Date
}

export type TimelineItem =
  | { kind: 'workout'; workout: TimelineWorkout; hero: boolean }
  | { kind: 'event'; event: TimelineEvent }

export interface TimelineBounds {
  startMin: number   // minutes since midnight
  endMin: number      // minutes since midnight (may exceed 1440 if an item runs past midnight)
}

export interface TimelineBlock {
  item: TimelineItem
  topPct: number      // 0-100, position within the bounds window
  heightPct: number   // 0-100, proportional height within the bounds window
  lane: number        // 0-based column, for side-by-side overlapping items
  laneCount: number    // total columns in this item's overlap cluster
}

const DEFAULT_START_MIN = 6 * 60   // 6am
const DEFAULT_END_MIN = 22 * 60    // 10pm
const MIN_WINDOW_MIN = 60          // never show a window smaller than 1 hour

function timeStrToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

// Minutes since the start of `event.start`'s own calendar day. Deliberately NOT
// clamped to 0-1439 — an event ending after midnight legitimately returns an
// end > 1440, which is exactly what lets it render as running off the bottom
// of the ruler instead of silently wrapping or clipping.
function dateToMin(d: Date, dayAnchor: Date): number {
  return (d.getTime() - dayAnchor.getTime()) / 60_000
}

function itemMinutes(item: TimelineItem): { start: number; end: number } {
  if (item.kind === 'workout') {
    const start = timeStrToMin(item.workout.planned_start_time)
    return { start, end: start + Math.max(1, item.workout.planned_duration_min) }
  }
  const anchor = new Date(item.event.start.getFullYear(), item.event.start.getMonth(), item.event.start.getDate())
  const start = dateToMin(item.event.start, anchor)
  const end = Math.max(start + 1, dateToMin(item.event.end, anchor))
  return { start, end }
}

/**
 * Pick the visible time window: the user's own wake/bed time when set (never a
 * one-size-fits-all default for someone with an unusual schedule), widened to
 * include any item that would otherwise be clipped off the ruler — a real
 * workout or event outside the "normal" hours must still be visible, not cut
 * off. `wakeTime`/`bedTime` are 'HH:MM:SS' strings, matching how they're
 * already stored on the profile everywhere else in the app.
 */
export function resolveBounds(
  items: TimelineItem[],
  wakeTime: string | null,
  bedTime: string | null,
): TimelineBounds {
  let startMin = wakeTime ? timeStrToMin(wakeTime) : DEFAULT_START_MIN
  const bedMin = bedTime ? timeStrToMin(bedTime) : null
  let endMin = bedMin != null && bedMin > startMin ? bedMin : DEFAULT_END_MIN

  for (const item of items) {
    const { start, end } = itemMinutes(item)
    if (start < startMin) startMin = start
    if (end > endMin) endMin = end
  }

  startMin = Math.max(0, Math.min(startMin, 23 * 60))
  endMin = Math.max(endMin, startMin + MIN_WINDOW_MIN)
  return { startMin, endMin }
}

// Greedy interval layout: cluster items that overlap (directly or transitively
// through a chain of overlaps) and assign each cluster its own lane count, so
// a single overlapping pair in an otherwise-clear day doesn't force every
// other block into a narrow column. Ties (equal start) break by whichever ends
// sooner, so the shorter item claims the earliest free lane.
function layoutLanes(entries: { start: number; end: number }[]): { lane: number; laneCount: number }[] {
  const order = entries.map((_, i) => i).sort((a, b) => entries[a].start - entries[b].start || entries[a].end - entries[b].end)
  const result: { lane: number; laneCount: number }[] = new Array(entries.length)

  let cluster: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    if (!cluster.length) return
    const laneEnds: number[] = []
    for (const idx of cluster) {
      const e = entries[idx]
      let lane = laneEnds.findIndex((end) => end <= e.start)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.end) } else { laneEnds[lane] = e.end }
      result[idx] = { lane, laneCount: 0 } // laneCount finalized below
    }
    const laneCount = laneEnds.length
    for (const idx of cluster) result[idx].laneCount = laneCount
    cluster = []
  }

  for (const idx of order) {
    const e = entries[idx]
    if (cluster.length && e.start >= clusterEnd) flush()
    cluster.push(idx)
    clusterEnd = Math.max(clusterEnd, e.end)
  }
  flush()

  return result
}

/**
 * Lay out today's items within `bounds`. Preserves the caller's item order
 * (Home's `dayGroups` already sorts chronologically) so rendering order stays
 * predictable. An item outside `bounds` is clamped defensively — in normal use
 * `bounds` should come from `resolveBounds`, which already widens to fit every
 * item, so this only matters if a caller supplies fixed bounds directly.
 */
export function buildDayTimeline(items: TimelineItem[], bounds: TimelineBounds): TimelineBlock[] {
  const span = Math.max(1, bounds.endMin - bounds.startMin)
  const entries = items.map(itemMinutes)
  const lanes = layoutLanes(entries)

  return items.map((item, i) => {
    const { start, end } = entries[i]
    const clampedStart = Math.min(Math.max(start, bounds.startMin), bounds.endMin)
    const clampedEnd = Math.min(Math.max(end, clampedStart + 1), bounds.endMin)
    return {
      item,
      topPct: ((clampedStart - bounds.startMin) / span) * 100,
      heightPct: Math.max(1, ((clampedEnd - clampedStart) / span) * 100),
      lane: lanes[i].lane,
      laneCount: lanes[i].laneCount,
    }
  })
}
