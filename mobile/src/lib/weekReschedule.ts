// Tempo — "Reschedule my whole week" planner (pure, no I/O → unit-testable).
//
// The payable magic: when real life upends the week (a trip, a new shift, a busy
// stretch), re-lay EVERY upcoming session at once — choosing the best DAY for each
// (recovery-aware, on allowed training days, around the real calendar) AND a
// calendar-aware TIME — in a single pass. Unlike `autoScheduleUpcoming` (which keeps
// each workout's day and only re-times it), this reassigns the DAY too.
//
// This module is the pure decision core (composing `scoreDay` + `findVariedSlot`);
// the DB + calendar I/O that feeds it lives in `reschedule.ts` (`rescheduleWholeWeek`).

import { findVariedSlot, type Availability, type BusySlot } from '@/lib/smartSchedule'
import { scoreDay, type Region, type DayLoad } from '@/lib/trainingLoad'

export const RESCHEDULE_HORIZON_DAYS = 7

export interface WeekWorkout {
  id: string
  regions: Set<Region>
  durationMin: number
  date: string            // current planned_date ('YYYY-MM-DD')
  startTime: string       // current planned_start_time ('HH:MM:SS')
}

export interface WeekAssignment {
  id: string
  date: string            // new 'YYYY-MM-DD'
  start_time: string      // new 'HH:MM:SS'
  reason: string          // why this day (recovery/balance)
  changed: boolean        // day or time actually differs from the current slot
}

export interface PlanWeekOptions {
  now: Date
  horizonDays?: number
  allowDays?: Set<number>   // ISO weekdays 1..7; empty/undefined = any day
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
}
function isoWeekday(d: Date): number { return ((d.getDay() + 6) % 7) + 1 } // Mon=1 … Sun=7

// Assign each workout (kept in plan order) to the best available day+time —
// recovery-aware, one workout per day, around `busy` and the fixed `priorLoads`
// (sessions that stay put). Workouts that find no opening within the horizon keep
// their current slot (`changed: false`), so a reschedule never *drops* a session.
export function planWeekReschedule(
  workouts: WeekWorkout[],
  busy: BusySlot[],
  availability: Availability,
  priorLoads: DayLoad[],
  opts: PlanWeekOptions,
): WeekAssignment[] {
  const horizon = opts.horizonDays ?? RESCHEDULE_HORIZON_DAYS
  const allowDays = opts.allowDays ?? new Set<number>()
  const today = new Date(opts.now); today.setHours(0, 0, 0, 0)

  const takenDays = new Set<string>()
  const loads: DayLoad[] = [...priorLoads]
  const occupied: BusySlot[] = [...busy]
  const out: WeekAssignment[] = []

  for (const w of workouts) {
    // Rank the open days (today … horizon) by recovery score, then soonest.
    const candidates: { day: Date; ds: string; score: number; reason: string }[] = []
    for (let off = 0; off < horizon; off++) {
      const day = new Date(today); day.setDate(today.getDate() + off)
      const ds = toDateStr(day)
      if (takenDays.has(ds)) continue
      if (allowDays.size && !allowDays.has(isoWeekday(day))) continue
      const { score, reason } = scoreDay(day, w.regions, loads)
      candidates.push({ day, ds, score, reason })
    }
    candidates.sort((a, b) => a.score - b.score || a.day.getTime() - b.day.getTime())

    let placed: WeekAssignment | null = null
    for (const c of candidates) {
      const isToday = c.day.getTime() === today.getTime()
      const slot = findVariedSlot(
        occupied,
        availability,
        { durationMinutes: w.durationMin, bufferMinutes: 10 },
        { now: isToday ? opts.now : c.day, horizonDays: 1, leadMinutes: isToday ? 30 : 0, seed: c.day.getDate() },
      )
      if (!slot) continue
      const start = new Date(slot.startTime)
      const startTime = fmtTime(start)
      placed = {
        id: w.id,
        date: c.ds,
        start_time: startTime,
        reason: c.reason,
        changed: c.ds !== w.date || startTime.slice(0, 5) !== w.startTime.slice(0, 5),
      }
      takenDays.add(c.ds)
      loads.push({ date: c.ds, regions: w.regions })
      occupied.push({ start, end: new Date(start.getTime() + w.durationMin * 60_000) })
      break
    }

    if (placed) {
      out.push(placed)
    } else {
      // No opening this week → keep the current slot, but still count its load so
      // the remaining workouts space around it.
      takenDays.add(w.date)
      loads.push({ date: w.date, regions: w.regions })
      out.push({ id: w.id, date: w.date, start_time: w.startTime, reason: 'Kept — no better slot this week', changed: false })
    }
  }

  return out
}
