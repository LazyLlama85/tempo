// Tempo — shared-availability engine (social scheduling, Stage 4).
//
// Turns a user's availability (sleep window, work/school hours, training days,
// "never" blocks) minus their already-scheduled workouts into FREE windows, then
// intersects two people's free windows to suggest times they can work out together.
// Pure + deterministic so it's unit-tested; no strength data anywhere.

export interface AvailabilityInputs {
  wake_time?: string | null // 'HH:MM[:SS]'
  bedtime?: string | null
  work_start?: string | null
  work_end?: string | null
  school_start?: string | null
  school_end?: string | null
  /** ISO weekdays 1=Mon…7=Sun the user is willing to train. Empty = any day. */
  training_days?: number[] | null
  unavailable_blocks?: UnavailableBlock[] | null
}

export interface UnavailableBlock {
  scope: 'weekday' | 'date'
  weekday?: number // 1–7
  date?: string // 'YYYY-MM-DD'
  allDay?: boolean
  start?: string
  end?: string
}

/** An already-committed workout (busy time) — subtracted from free windows. */
export interface BusySlot { date: string; start: string; duration_min: number }

/** A free (or overlapping) window, minutes-from-midnight. */
export interface Window { date: string; startMin: number; endMin: number }

export interface SharedSlot { date: string; startMin: number; endMin: number; label: string }

const DEFAULT_WAKE = 6 * 60 + 30 // 06:30
const DEFAULT_BED = 22 * 60 + 30 // 22:30

/**
 * Work and school hours are Monday–Friday commitments. They used to be applied to
 * every day of the week, which silently blocked Saturday and Sunday 09:00–17:00
 * for every 9-to-5 user and the whole school day for every student — so weekend
 * sessions were pushed into the evening or refused outright (found 2026-09-02
 * while auditing the class of bug behind the 07:00-during-school report).
 * Someone who genuinely works weekends adds an unavailable block for it.
 */
export const isWeekdayCommitmentDay = (weekday: number) => weekday >= 1 && weekday <= 5

export function toMinutes(t?: string | null): number | null {
  if (!t) return null
  const [h, m] = t.split(':')
  const hh = parseInt(h, 10)
  const mm = parseInt(m ?? '0', 10)
  return Number.isNaN(hh) ? null : hh * 60 + (Number.isNaN(mm) ? 0 : mm)
}

/** '6:30 PM' for minutes-from-midnight. */
export function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ap = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`
}

/** '18:30:00' (storage form) for minutes-from-midnight. */
export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

/** ISO weekday (1=Mon … 7=Sun) for a 'YYYY-MM-DD'. */
export function isoWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return ((d.getUTCDay() + 6) % 7) + 1
}

function mergeIntervals(iv: [number, number][]): [number, number][] {
  const sorted = [...iv].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const cur of sorted) {
    const last = out[out.length - 1]
    if (last && cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1])
    else out.push([cur[0], cur[1]])
  }
  return out
}

/** Free sub-intervals of [start,end] after removing the busy intervals. */
function subtractBusy(start: number, end: number, busy: [number, number][]): [number, number][] {
  const clipped = busy
    .filter(([s, e]) => e > start && s < end)
    .map(([s, e]) => [Math.max(s, start), Math.min(e, end)] as [number, number])
  const merged = mergeIntervals(clipped)
  const free: [number, number][] = []
  let cursor = start
  for (const [s, e] of merged) {
    if (s > cursor) free.push([cursor, s])
    cursor = Math.max(cursor, e)
  }
  if (cursor < end) free.push([cursor, end])
  return free
}

/**
 * Free windows across the given dates (waking hours minus work/school/blocks/busy).
 * Pass `opts.todayStr` + `opts.nowMin` to never return times already in the past
 * today (start is clamped forward to the next :30).
 */
export function freeWindows(
  av: AvailabilityInputs,
  busy: BusySlot[],
  dates: string[],
  opts?: { todayStr?: string; nowMin?: number },
): Window[] {
  const wake = toMinutes(av.wake_time) ?? DEFAULT_WAKE
  const bed = toMinutes(av.bedtime) ?? DEFAULT_BED
  const dayStart = Math.min(wake, bed)
  const dayEnd = Math.max(wake, bed)
  const trainingDays = av.training_days ?? []
  const out: Window[] = []

  for (const date of dates) {
    const dow = isoWeekday(date)
    if (trainingDays.length && !trainingDays.includes(dow)) continue

    // Today never offers a slot that's already passed.
    let dStart = dayStart
    if (opts?.todayStr === date && opts?.nowMin != null) {
      dStart = Math.max(dayStart, Math.ceil(opts.nowMin / 30) * 30)
    }
    if (dStart >= dayEnd) continue

    const busyIv: [number, number][] = []
    const add = (s: number | null, e: number | null) => { if (s != null && e != null && e > s) busyIv.push([s, e]) }
    if (isWeekdayCommitmentDay(dow)) {
      add(toMinutes(av.work_start), toMinutes(av.work_end))
      add(toMinutes(av.school_start), toMinutes(av.school_end))
    }
    for (const b of av.unavailable_blocks ?? []) {
      const applies = (b.scope === 'weekday' && b.weekday === dow) || (b.scope === 'date' && b.date === date)
      if (!applies) continue
      if (b.allDay) busyIv.push([dStart, dayEnd])
      else add(toMinutes(b.start), toMinutes(b.end))
    }
    for (const s of busy) {
      if (s.date !== date) continue
      const st = toMinutes(s.start)
      if (st != null) add(st, st + s.duration_min)
    }

    for (const [s, e] of subtractBusy(dStart, dayEnd, busyIv)) out.push({ date, startMin: s, endMin: e })
  }
  return out
}

/**
 * Free intervals (minutes from midnight) on a given ISO weekday, from waking
 * hours minus work, school and any weekday-scoped unavailable blocks. Date-less,
 * so plan generation can reason about "a typical Tuesday" weeks ahead without
 * inventing calendar dates.
 */
export function weekdayFreeIntervals(av: AvailabilityInputs, weekday: number): [number, number][] {
  const wake = toMinutes(av.wake_time) ?? DEFAULT_WAKE
  const bed = toMinutes(av.bedtime) ?? DEFAULT_BED
  const dayStart = Math.min(wake, bed)
  const dayEnd = Math.max(wake, bed)

  const busy: [number, number][] = []
  const add = (st: number | null, e: number | null) => { if (st != null && e != null && e > st) busy.push([st, e]) }
  if (isWeekdayCommitmentDay(weekday)) {
    add(toMinutes(av.work_start), toMinutes(av.work_end))
    add(toMinutes(av.school_start), toMinutes(av.school_end))
  }
  for (const b of av.unavailable_blocks ?? []) {
    if (b.scope !== 'weekday' || b.weekday !== weekday) continue
    if (b.allDay) busy.push([dayStart, dayEnd])
    else add(toMinutes(b.start), toMinutes(b.end))
  }
  return subtractBusy(dayStart, dayEnd, busy)
}

/** Getting-up buffer: nobody trains the minute their alarm goes off. */
export const WAKE_BUFFER_MIN = 30

/** Weekdays, a session should not start before this unless nothing else fits. */
export const WEEKDAY_EARLIEST_MIN = 8 * 60

/**
 * Pick a start minute for a session on `weekday`, given preferred start times in
 * priority order. Returns null when the day has no window long enough at all.
 *
 * This exists because plan generation used to pick from a hardcoded table keyed
 * only on preferred time-of-day, with no idea when the user wakes, works or is
 * at school. A user who said "wake 06:30, school 07:00" and picked "morning" was
 * given a 07:00 session — the exact minute school starts (founder report,
 * 2026-09-02). The rules, in order of how hard they are:
 *
 *  1. Hard: the WHOLE session must fit inside a free window, and never start
 *     before wake + WAKE_BUFFER_MIN.
 *  2. Soft: on Mon–Fri prefer not to start before WEEKDAY_EARLIEST_MIN. Honoured
 *     only when something later actually fits — a user whose sole free window is
 *     early still gets that window rather than nothing.
 *  3. Fallback: anchor to the longest window that fits, rounded to :00/:30.
 */
export function chooseSessionStart(opts: {
  candidates: number[]
  weekday: number
  durationMin: number
  av: AvailabilityInputs
  weekdayEarliestMin?: number
  wakeBufferMin?: number
}): number | null {
  const { candidates, weekday, durationMin, av } = opts
  const earliestSoft = opts.weekdayEarliestMin ?? WEEKDAY_EARLIEST_MIN
  const buffer = opts.wakeBufferMin ?? WAKE_BUFFER_MIN
  const wake = toMinutes(av.wake_time) ?? DEFAULT_WAKE
  const hardEarliest = wake + buffer
  const isWeekday = weekday >= 1 && weekday <= 5

  const windows = weekdayFreeIntervals(av, weekday)
    .map(([s, e]) => [Math.max(s, hardEarliest), e] as [number, number])
    .filter(([s, e]) => e - s >= durationMin)
  if (windows.length === 0) return null

  const fits = (start: number) => windows.some(([s, e]) => start >= s && start + durationMin <= e)

  const softFloor = isWeekday ? earliestSoft : 0
  for (const c of candidates) if (c >= softFloor && fits(c)) return c
  for (const c of candidates) if (fits(c)) return c

  // Nothing on the preferred list fits: anchor to a real window. Prefer one that
  // clears the soft floor, then the longest.
  const ranked = [...windows].sort((a, b) => {
    const aOk = a[1] - Math.max(a[0], softFloor) >= durationMin ? 0 : 1
    const bOk = b[1] - Math.max(b[0], softFloor) >= durationMin ? 0 : 1
    return aOk - bOk || (b[1] - b[0]) - (a[1] - a[0])
  })
  const [ws, we] = ranked[0]
  const from = Math.max(ws, we - durationMin >= softFloor ? softFloor : ws)
  const rounded = Math.ceil(Math.max(ws, from) / 30) * 30
  const start = Math.min(Math.max(rounded, ws), we - durationMin)
  return start >= ws ? start : ws
}

/** Local 'YYYY-MM-DD' and minutes-since-midnight for "now" (past-time filtering). */
export function localNow(now: Date): { todayStr: string; nowMin: number } {
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    todayStr: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
    nowMin: now.getHours() * 60 + now.getMinutes(),
  }
}

/** Windows where both people are free for at least `minDurationMin`. */
export function overlapWindows(a: Window[], b: Window[], minDurationMin: number): Window[] {
  const byDate = new Map<string, Window[]>()
  for (const w of b) {
    const arr = byDate.get(w.date)
    if (arr) arr.push(w)
    else byDate.set(w.date, [w])
  }
  const out: Window[] = []
  for (const wa of a) {
    for (const wb of byDate.get(wa.date) ?? []) {
      const s = Math.max(wa.startMin, wb.startMin)
      const e = Math.min(wa.endMin, wb.endMin)
      if (e - s >= minDurationMin) out.push({ date: wa.date, startMin: s, endMin: e })
    }
  }
  return out
}

const TOD_CENTER: Record<string, number> = {
  morning: 8 * 60, // 8:00
  afternoon: 14 * 60, // 14:00
  evening: 18 * 60, // 18:00
}

/**
 * Suggest a short list of concrete start times two friends could train together:
 * one per overlapping window, anchored to :00/:30, biased toward the preferred
 * time of day when it falls inside the window. Soonest first, capped.
 */
export function suggestSharedSlots(
  overlaps: Window[],
  durationMin: number,
  opts?: { preferredTimeOfDay?: string | null; maxTotal?: number },
): SharedSlot[] {
  const center = opts?.preferredTimeOfDay ? TOD_CENTER[opts.preferredTimeOfDay] : undefined
  const slots: SharedSlot[] = []
  for (const w of overlaps) {
    if (w.endMin - w.startMin < durationMin) continue
    const latestStart = w.endMin - durationMin
    // Anchor toward the preferred time of day, else the start of the window.
    const target = center != null ? Math.min(Math.max(center, w.startMin), latestStart) : w.startMin
    const start = Math.min(Math.max(Math.round(target / 30) * 30, w.startMin), latestStart)
    slots.push({ date: w.date, startMin: start, endMin: start + durationMin, label: minutesToLabel(start) })
  }
  slots.sort((x, y) => x.date.localeCompare(y.date) || x.startMin - y.startMin)
  return slots.slice(0, opts?.maxTotal ?? 6)
}

/** The next `count` calendar dates starting from `fromDateStr` (inclusive). */
export function upcomingDates(fromDateStr: string, count: number): string[] {
  const out: string[] = []
  const base = new Date(`${fromDateStr}T00:00:00Z`).getTime()
  for (let i = 0; i < count; i++) out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10))
  return out
}
