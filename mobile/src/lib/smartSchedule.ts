// Tempo — smart scheduling engine (pure, no I/O → unit-testable).
//
// Given the user's REAL availability (sleep window, work/school hours, which
// weekdays they'll train, preferred time of day) plus the busy blocks pulled from
// their calendar, pick a workout slot that:
//   • never lands during sleep, work, or school,
//   • only falls on an allowed training day,
//   • favours the user's preferred time of day, and
//   • VARIES naturally day-to-day instead of always picking the same hour.
//
// The old engine returned the first open gap, so a free morning meant 6:00 AM
// every single day. Here we enumerate snapped candidate starts and rotate the
// choice by a seed (and skip the previous pick's time), so a week reads like a
// human planned it.

import type { TimeOfDay, UnavailableBlock } from '@/types'

export interface BusySlot { start: Date; end: Date }

export interface Availability {
  wakeTime: string | null      // 'HH:MM[:SS]'
  bedtime: string | null
  workStart: string | null
  workEnd: string | null
  schoolStart: string | null
  schoolEnd: string | null
  preferredTimeOfDay: TimeOfDay | null
  trainingDays: number[]       // ISO 1=Mon … 7=Sun; empty = any day
  // Hard "never schedule here" windows (recurring weekday or one-off date). The
  // scheduler blocks these out like a meeting, so a workout never lands on them.
  unavailable?: UnavailableBlock[]
}

export interface SlotConstraints {
  durationMinutes: number
  bufferMinutes?: number       // breathing room required AFTER the session
}

export interface SlotPick { startTime: string; endTime: string }

export interface FindOptions {
  now?: Date
  horizonDays?: number         // days ahead to consider (default 7)
  leadMinutes?: number         // don't book sooner than this from now (default 60)
  seed?: number                // rotates the choice so days/sessions differ
  avoidStartMinute?: number    // minute-of-day to avoid (e.g. the previous pick)
}

const STEP_MIN = 15
const DEFAULT_WAKE = 6 * 60 + 30
const DEFAULT_BED = 22 * 60 + 30

const TOD_WINDOWS: Record<TimeOfDay, [number, number]> = {
  morning: [6 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 21 * 60],
}

interface Interval { start: number; end: number } // minutes from midnight

// 'HH:MM[:SS]' → minutes from midnight (null/invalid → fallback).
function hmToMin(t: string | null | undefined, fallback: number): number {
  if (!t) return fallback
  const [h, m] = t.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return fallback
  return h * 60 + m
}

function isoWeekday(d: Date): number { return ((d.getDay() + 6) % 7) + 1 } // Mon=1 … Sun=7
function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function atMinute(day: Date, min: number): Date { const x = startOfDay(day); x.setMinutes(min); return x }
function minuteOfDay(d: Date): number { return d.getHours() * 60 + d.getMinutes() }
function sameDay(a: Date, b: Date): boolean { return startOfDay(a).getTime() === startOfDay(b).getTime() }

// Recurring daily commitments (work + school) as minute-intervals. Sleep is
// handled by clamping the search to [wake, bed]; calendar busy slots merge in later.
function recurringBlocks(avail: Availability): Interval[] {
  const blocks: Interval[] = []
  const ws = hmToMin(avail.workStart, -1), we = hmToMin(avail.workEnd, -1)
  if (ws >= 0 && we > ws) blocks.push({ start: ws, end: we })
  const ss = hmToMin(avail.schoolStart, -1), se = hmToMin(avail.schoolEnd, -1)
  if (ss >= 0 && se > ss) blocks.push({ start: ss, end: se })
  return blocks
}

// Hard user-defined unavailability falling on `day`: a recurring-weekday match or
// a one-off date match. All-day blocks the whole day; a time range blocks its span.
function unavailableForDay(day: Date, blocks: UnavailableBlock[] | undefined): Interval[] {
  if (!blocks?.length) return []
  const wd = isoWeekday(day)
  const ds = dateStr(day)
  const out: Interval[] = []
  for (const b of blocks) {
    const matches = b.scope === 'weekday' ? b.weekday === wd : b.date === ds
    if (!matches) continue
    if (b.allDay) { out.push({ start: 0, end: 24 * 60 }); continue }
    const s = hmToMin(b.start, -1), e = hmToMin(b.end, -1)
    if (s >= 0 && e > s) out.push({ start: s, end: e })
  }
  return out
}

function mergeIntervals(xs: Interval[]): Interval[] {
  if (!xs.length) return []
  const sorted = [...xs].sort((a, b) => a.start - b.start)
  const merged: Interval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i].start <= last.end) last.end = Math.max(last.end, sorted[i].end)
    else merged.push({ ...sorted[i] })
  }
  return merged
}

// All blocked intervals (minutes-from-midnight) for `day`: recurring + that day's
// calendar busy slots, clipped to the day and merged.
function blocksForDay(day: Date, avail: Availability, busy: BusySlot[]): Interval[] {
  const d0 = startOfDay(day).getTime()
  const dayEnd = d0 + 24 * 60 * 60 * 1000
  const out = [...recurringBlocks(avail), ...unavailableForDay(day, avail.unavailable)]
  for (const b of busy) {
    const bs = b.start.getTime(), be = b.end.getTime()
    if (be <= d0 || bs >= dayEnd) continue
    const s = Math.max(0, Math.round((bs - d0) / 60000))
    const e = Math.min(24 * 60, Math.round((be - d0) / 60000))
    if (e > s) out.push({ start: s, end: e })
  }
  return mergeIntervals(out)
}

// Snapped candidate start-minutes within [winStart,winEnd] that fit `needed`
// minutes without overlapping any block.
function candidateStarts(winStart: number, winEnd: number, blocks: Interval[], needed: number): number[] {
  const starts: number[] = []
  const pushRange = (from: number, to: number) => {
    let s = Math.ceil(from / STEP_MIN) * STEP_MIN
    for (; s + needed <= to; s += STEP_MIN) starts.push(s)
  }
  let cursor = winStart
  const relevant = blocks.filter(b => b.end > winStart && b.start < winEnd).sort((a, b) => a.start - b.start)
  for (const b of relevant) {
    if (b.start > cursor) pushRange(cursor, Math.min(b.start, winEnd))
    cursor = Math.max(cursor, b.end)
    if (cursor >= winEnd) break
  }
  if (cursor < winEnd) pushRange(cursor, winEnd)
  return starts
}

// Pick one start-minute, rotated by seed, avoiding a specific minute when possible.
function pickVaried(cands: number[], seed: number, avoid?: number): number | null {
  if (!cands.length) return null
  // ×5 stride spreads the choice across the day rather than clustering at the top.
  let idx = (Math.abs(seed) * 5) % cands.length
  if (avoid != null && cands[idx] === avoid && cands.length > 1) idx = (idx + 1) % cands.length
  return cands[idx]
}

// The main entry: the best single slot, or null if the week is genuinely full.
export function findVariedSlot(
  busy: BusySlot[],
  avail: Availability,
  constraints: SlotConstraints,
  options: FindOptions = {},
): SlotPick | null {
  const now = options.now ?? new Date()
  const horizon = options.horizonDays ?? 7
  const lead = options.leadMinutes ?? 60
  const seed = options.seed ?? 0
  const needed = constraints.durationMinutes + (constraints.bufferMinutes ?? 0)

  const wake = hmToMin(avail.wakeTime, DEFAULT_WAKE)
  const bed = hmToMin(avail.bedtime, DEFAULT_BED)
  const earliest = new Date(now.getTime() + lead * 60000)
  const allowDays = new Set(avail.trainingDays ?? [])

  const pref = avail.preferredTimeOfDay
  // Try the preferred window across the week first, then widen to all waking hours.
  const windows: [number, number][] = pref ? [TOD_WINDOWS[pref], [wake, bed]] : [[wake, bed]]

  for (const [wStart, wEnd] of windows) {
    for (let dOff = 0; dOff < horizon; dOff++) {
      const day = startOfDay(now); day.setDate(day.getDate() + dOff)
      if (allowDays.size && !allowDays.has(isoWeekday(day))) continue

      let winStart = Math.max(wake, wStart)
      const winEnd = Math.min(bed, wEnd)
      // Respect the lead time on the first day; if it spills past today, skip today.
      if (dOff === 0) {
        if (!sameDay(earliest, day)) continue
        winStart = Math.max(winStart, minuteOfDay(earliest))
      }
      if (winStart >= winEnd) continue

      const blocks = blocksForDay(day, avail, busy)
      const startMin = pickVaried(candidateStarts(winStart, winEnd, blocks, needed), seed + dOff, options.avoidStartMinute)
      if (startMin != null) {
        const start = atMinute(day, startMin)
        const end = new Date(start.getTime() + constraints.durationMinutes * 60000)
        return { startTime: start.toISOString(), endTime: end.toISOString() }
      }
    }
  }
  return null
}
