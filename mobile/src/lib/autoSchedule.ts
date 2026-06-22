// Tempo — automatic smart scheduling.
//
// "Smart scheduling is the whole point" — so it shouldn't be a button. When a plan
// is generated, this places each upcoming workout at a real, calendar-aware time:
// it reads the busy windows from the calendar the user actually chose, then picks a
// varied opening on each workout's existing day that avoids meetings, work, school,
// and sleep. It only adjusts the TIME — never the day — so the plan's recovery
// spacing (Mon/Wed/Fri …) stays intact.
//
// Everything here is best-effort: if no calendar is connected, or a read fails, it
// quietly leaves the template times in place rather than blocking the user.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getBusyBlocks, getCalendarPermissionStatus } from '@/services/calendarService'
import { isGoogleCalendarConnected } from '@/services/googleCalendar/CalendarAuthService'
import { fetchUserBusySlots } from '@/services/googleCalendar/CalendarApiService'
import { findVariedSlot, type Availability, type BusySlot } from '@/lib/smartSchedule'
import type { CalendarProvider } from '@/types'

const HORIZON_DAYS = 14

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function sameDay(a: Date, b: Date): boolean { return startOfDay(a).getTime() === startOfDay(b).getTime() }
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
}

interface WorkoutRow {
  id: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number
}

// Busy windows from the calendar the user CHOSE (preferred), falling back to
// whichever is connected. This is what makes auto-scheduling read the *right*
// agenda — e.g. a user whose real events live on their device calendar, not the
// Google account that only holds Tempo's own workout events.
async function gatherBusy(
  preferred: CalendarProvider | null,
  horizonDays: number,
  from: Date,
): Promise<BusySlot[]> {
  const readGoogle = async (): Promise<BusySlot[] | null> =>
    (await isGoogleCalendarConnected()) ? await fetchUserBusySlots(horizonDays) : null

  const readDevice = async (): Promise<BusySlot[] | null> => {
    if ((await getCalendarPermissionStatus()) !== 'granted') return null
    const busy: BusySlot[] = []
    for (let i = 0; i < horizonDays; i++) {
      const d = new Date(from); d.setDate(from.getDate() + i)
      busy.push(...await getBusyBlocks(d))
    }
    return busy
  }

  // Read the user's chosen calendar first; fall back to the other if it errors.
  const order = preferred === 'device' ? [readDevice, readGoogle] : [readGoogle, readDevice]
  for (const read of order) {
    try { const r = await read(); if (r) return r } catch { /* try the next provider */ }
  }
  return []
}

// Place every upcoming scheduled workout at a real, calendar-aware time. Returns
// how many were moved. Re-running simply re-optimises around the current calendar.
export async function autoScheduleUpcoming(client: SupabaseClient, userId: string): Promise<number> {
  const now = new Date()
  const today = startOfDay(now)
  const horizonEnd = new Date(today); horizonEnd.setDate(today.getDate() + HORIZON_DAYS)

  const { data: p } = await client
    .from('user_profiles')
    .select('wake_time, bedtime, work_start, work_end, school_start, school_end, preferred_time_of_day, training_days, preferred_calendar')
    .eq('user_id', userId)
    .maybeSingle()
  if (!p) return 0

  const availability: Availability = {
    wakeTime: p.wake_time ?? null,
    bedtime: p.bedtime ?? null,
    workStart: p.work_start ?? null,
    workEnd: p.work_end ?? null,
    schoolStart: p.school_start ?? null,
    schoolEnd: p.school_end ?? null,
    preferredTimeOfDay: (p.preferred_time_of_day as Availability['preferredTimeOfDay']) ?? null,
    // The plan already chose the DAY; we only optimise the TIME on it, so don't let
    // the training-day filter veto a day a workout already lives on.
    trainingDays: [],
  }

  const busy = await gatherBusy((p.preferred_calendar as CalendarProvider | null) ?? null, HORIZON_DAYS, today)

  // Nothing to schedule around (no calendar connected, no work/school hours set) →
  // leave the plan's curated, time-of-day-aware template times alone rather than
  // shuffling them for no reason.
  if (busy.length === 0 && !p.work_start && !p.school_start) return 0

  const { data: workouts } = await client
    .from('scheduled_workouts')
    .select('id, planned_date, planned_start_time, planned_duration_min')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .gte('planned_date', toDateStr(today))
    .lte('planned_date', toDateStr(horizonEnd))
    .order('planned_date')
    .order('planned_start_time')
  if (!workouts?.length) return 0

  // Occupied = real calendar events + workouts we've already placed, so two
  // workouts never land on top of each other on a shared day.
  const occupied: BusySlot[] = [...busy]
  let moved = 0

  for (const w of workouts as WorkoutRow[]) {
    const day = startOfDay(new Date(`${w.planned_date}T00:00:00`))
    const isToday = sameDay(day, now)
    const slot = findVariedSlot(
      occupied,
      availability,
      { durationMinutes: w.planned_duration_min, bufferMinutes: 10 },
      {
        now: isToday ? now : day,        // today respects "now"; future days start at 00:00
        horizonDays: 1,                   // place on the SAME day — keep recovery spacing
        leadMinutes: isToday ? 30 : 0,    // a little breathing room before today's session
        seed: day.getDate(),              // varied but deterministic per day
      },
    )
    if (!slot) continue                   // day genuinely full → keep the template time

    const start = new Date(slot.startTime)
    const newTime = fmtClock(start)
    if (newTime !== w.planned_start_time) {
      await client.from('scheduled_workouts')
        .update({ planned_start_time: newTime })
        .eq('id', w.id)
        .eq('user_id', userId)
      moved++
    }
    occupied.push({ start, end: new Date(start.getTime() + w.planned_duration_min * 60_000) })
  }

  return moved
}

// Conflict-only re-optimisation, safe to run on every app open. Unlike
// autoScheduleUpcoming (which optimises every time at plan creation), this leaves
// workouts exactly where they are UNLESS a real calendar event now overlaps one —
// then it quietly re-slots just that workout to a free opening on the SAME day, so
// times the user has already planned around stay stable. Returns how many moved.
export async function resolveCalendarConflicts(client: SupabaseClient, userId: string): Promise<number> {
  const now = new Date()
  const today = startOfDay(now)
  const horizonEnd = new Date(today); horizonEnd.setDate(today.getDate() + HORIZON_DAYS)

  const { data: p } = await client
    .from('user_profiles')
    .select('wake_time, bedtime, work_start, work_end, school_start, school_end, preferred_time_of_day, preferred_calendar')
    .eq('user_id', userId)
    .maybeSingle()
  if (!p) return 0

  // Day is already chosen — we only re-place the TIME on it, so don't let the
  // training-day filter veto the workout's existing day.
  const availability: Availability = {
    wakeTime: p.wake_time ?? null,
    bedtime: p.bedtime ?? null,
    workStart: p.work_start ?? null,
    workEnd: p.work_end ?? null,
    schoolStart: p.school_start ?? null,
    schoolEnd: p.school_end ?? null,
    preferredTimeOfDay: (p.preferred_time_of_day as Availability['preferredTimeOfDay']) ?? null,
    trainingDays: [],
  }

  // Conflicts are with real calendar EVENTS only ("a new meeting overlaps it") —
  // not work/school, which are availability the re-slot already routes around.
  const busy = await gatherBusy((p.preferred_calendar as CalendarProvider | null) ?? null, HORIZON_DAYS, today)
  if (!busy.length) return 0

  const { data: workouts } = await client
    .from('scheduled_workouts')
    .select('id, planned_date, planned_start_time, planned_duration_min')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .gte('planned_date', toDateStr(today))
    .lte('planned_date', toDateStr(horizonEnd))
    .order('planned_date')
    .order('planned_start_time')
  if (!workouts?.length) return 0

  const busyTimes = busy.map(b => [b.start.getTime(), b.end.getTime()] as const)
  const occupied: BusySlot[] = [...busy]
  let moved = 0

  for (const w of workouts as WorkoutRow[]) {
    const start = new Date(`${w.planned_date}T${w.planned_start_time}`)
    const end = new Date(start.getTime() + w.planned_duration_min * 60_000)
    const conflict = busyTimes.some(([bs, be]) => start.getTime() < be && bs < end.getTime())
    if (!conflict) { occupied.push({ start, end }); continue }

    const day = startOfDay(start)
    const isToday = sameDay(day, now)
    const slot = findVariedSlot(
      occupied,
      availability,
      { durationMinutes: w.planned_duration_min, bufferMinutes: 10 },
      {
        now: isToday ? now : day,
        horizonDays: 1,                          // SAME day only — never silently move the day
        leadMinutes: isToday ? 30 : 0,
        seed: day.getDate() + start.getHours(),  // vary away from the conflicting time
      },
    )
    // Day is genuinely full — leave it; the missed-workout flow offers a new slot later.
    if (!slot) { occupied.push({ start, end }); continue }

    const ns = new Date(slot.startTime)
    const newTime = fmtClock(ns)
    if (newTime !== w.planned_start_time) {
      await client.from('scheduled_workouts')
        .update({ planned_start_time: newTime })
        .eq('id', w.id)
        .eq('user_id', userId)
      moved++
    }
    occupied.push({ start: ns, end: new Date(ns.getTime() + w.planned_duration_min * 60_000) })
  }

  return moved
}
