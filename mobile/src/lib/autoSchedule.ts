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
import { GCAL_PRIMARY } from '@/services/googleCalendar/config'
import { getCalendarEventsForRange } from '@/services/calendarSync'
import type { DayEvent } from '@/services/calendarService'
import { findVariedSlot, type Availability, type BusySlot } from '@/lib/smartSchedule'
import { getUnavailableBlocks } from '@/lib/unavailability'
import { getIgnoredEventKeys, filterIgnoredBusy, eventKey } from '@/lib/ignoredEvents'
import { resyncMovedWorkout } from '@/lib/moveWorkout'
import { captureApiError } from '@/lib/crashReporting'
import { toDateStr } from '@/lib/dates'
import { isProLockedNow } from '@/stores/entitlements'
import type { CalendarProvider } from '@/types'

const HORIZON_DAYS = 14

// The Monday-Sunday end of the week containing `d` — matches the week
// boundary already used elsewhere (useProgressStats' getMondayOf, the
// leaderboard's ISO week). Free auto-scheduling (§24/§30 L1) only fits the
// CURRENT week; a locked (free, Pro-live) user's workouts beyond this date
// keep their generated template times untouched, rather than being silently
// time-optimized around the calendar — that ambient optimization is the paid
// part now, not the plan's existence, which is never gated.
function endOfWeek(d: Date): Date {
  const day = d.getDay() // 0=Sun..6=Sat
  const end = new Date(d)
  end.setDate(d.getDate() + (day === 0 ? 0 : 7 - day))
  end.setHours(23, 59, 59, 999)
  return end
}

// Connecting a calendar no longer forces automatic scheduling. Auto-placement and
// conflict re-slotting only run when the user's scheduling_mode is 'auto' (the
// default). Absent/unknown is treated as 'auto' so existing users are unaffected.
export function autoSchedulingEnabled(
  profile: { scheduling_mode?: string | null } | null | undefined,
): boolean {
  return profile?.scheduling_mode !== 'manual'
}

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function sameDay(a: Date, b: Date): boolean { return startOfDay(a).getTime() === startOfDay(b).getTime() }
function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
}

interface WorkoutRow {
  id: string
  focus: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number
  calendar_event_id: string | null
  calendar_provider: CalendarProvider | null
}

const MOVE_COLS = 'id, focus, planned_date, planned_start_time, planned_duration_min, calendar_event_id, calendar_provider'

// Busy windows from the calendar the user CHOSE (preferred), falling back to
// whichever is connected. This is what makes auto-scheduling read the *right*
// agenda — e.g. a user whose real events live on their device calendar, not the
// Google account that only holds Tempo's own workout events.
async function gatherBusy(
  preferred: CalendarProvider | null,
  horizonDays: number,
  from: Date,
  selectedGoogleCalendarIds?: string[] | null,
): Promise<BusySlot[]> {
  // selected_google_calendar_ids stores only the calendars BEYOND primary
  // (see add_selected_calendars.sql) — primary always stays in the read.
  const calendarIds = selectedGoogleCalendarIds?.length
    ? [GCAL_PRIMARY, ...selectedGoogleCalendarIds.filter(id => id !== GCAL_PRIMARY)]
    : undefined

  const readGoogle = async (): Promise<BusySlot[] | null> =>
    (await isGoogleCalendarConnected()) ? await fetchUserBusySlots(horizonDays, calendarIds) : null

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
  // §24/§30 L1: a locked (free, Pro-live) user's ambient auto-scheduling only
  // reaches the end of the current week. Dormant/Pro → null → unchanged,
  // full-horizon behavior (the non-negotiable "byte-identical while dormant"
  // regression this gate must never break).
  const freeWindowEnd = isProLockedNow() ? endOfWeek(today) : null

  const { data: p } = await client
    .from('user_profiles')
    .select('wake_time, bedtime, work_start, work_end, school_start, school_end, preferred_time_of_day, training_days, preferred_calendar, scheduling_mode, selected_google_calendar_ids')
    .eq('user_id', userId)
    .maybeSingle()
  if (!p) return 0
  // Manual scheduling: the user owns the times — never move them automatically.
  if (!autoSchedulingEnabled(p)) return 0

  const unavailable = await getUnavailableBlocks(client, userId)
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
    unavailable,
  }

  // Events the user crossed off ("ignore") shouldn't block scheduling — drop them.
  const ignored = await getIgnoredEventKeys(client, userId)
  const busy = filterIgnoredBusy(
    await gatherBusy((p.preferred_calendar as CalendarProvider | null) ?? null, HORIZON_DAYS, today, p.selected_google_calendar_ids as string[] | null),
    ignored,
  )

  // Nothing to schedule around (no calendar, no work/school hours, no blocked-off
  // times) → leave the plan's curated, time-of-day-aware template times alone.
  if (busy.length === 0 && !p.work_start && !p.school_start && unavailable.length === 0) return 0

  const { data: workouts } = await client
    .from('scheduled_workouts')
    .select(MOVE_COLS)
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
    // Beyond the free window: the session still exists and is fully usable,
    // just not auto-fitted around the calendar — leave its template time
    // alone and don't let it occupy the timeline (it's chronologically after
    // every in-window workout, so it can never block one of those placements).
    if (freeWindowEnd && day > freeWindowEnd) continue
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
      // Best-effort by design (this is a quiet re-optimization, not a user
      // action to fail loudly on) — but a silently-discarded error here used
      // to mean the calendar event/reminder could get resynced to a time the
      // DB row never actually moved to. Only resync + count it on success,
      // and report a failure so DB/calendar divergence is at least visible.
      const { error } = await client.from('scheduled_workouts')
        .update({ planned_start_time: newTime })
        .eq('id', w.id)
        .eq('user_id', userId)
      if (error) {
        captureApiError('autoScheduleUpcoming.updateTime', error, { userId, workoutId: w.id })
      } else {
        // Keep the synced calendar event + local reminder pointed at the new time.
        await resyncMovedWorkout(client, userId, { ...w, planned_start_time: newTime })
        moved++
      }
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
//
// §24/§30 L2: this silent auto-move is the Pro half of the conflict gate — a
// locked (free, Pro-live) user gets findCalendarConflicts (below) instead,
// which detects the exact same conflicts but never touches the DB, so Home
// can offer "move it myself" / "let Tempo handle this" instead of moving
// anything without asking. Self-gated (not gated at the call site) so every
// caller — the app-open sweep, any future one — is automatically correct.
export async function resolveCalendarConflicts(client: SupabaseClient, userId: string): Promise<number> {
  if (isProLockedNow()) return 0

  const now = new Date()
  const today = startOfDay(now)
  const horizonEnd = new Date(today); horizonEnd.setDate(today.getDate() + HORIZON_DAYS)

  const { data: p } = await client
    .from('user_profiles')
    .select('wake_time, bedtime, work_start, work_end, school_start, school_end, preferred_time_of_day, preferred_calendar, scheduling_mode, selected_google_calendar_ids')
    .eq('user_id', userId)
    .maybeSingle()
  if (!p) return 0
  // Manual scheduling: leave every workout exactly where the user put it.
  if (!autoSchedulingEnabled(p)) return 0

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
    unavailable: await getUnavailableBlocks(client, userId),
  }

  // Conflicts are with real calendar EVENTS only ("a new meeting overlaps it") —
  // not work/school, which are availability the re-slot already routes around. Events
  // the user has crossed off ("ignore") are dropped, so a workout may sit over them.
  const ignored = await getIgnoredEventKeys(client, userId)
  const busy = filterIgnoredBusy(
    await gatherBusy((p.preferred_calendar as CalendarProvider | null) ?? null, HORIZON_DAYS, today, p.selected_google_calendar_ids as string[] | null),
    ignored,
  )
  if (!busy.length) return 0

  const { data: workouts } = await client
    .from('scheduled_workouts')
    .select(MOVE_COLS)
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
      // Same reasoning as autoScheduleUpcoming above: only resync + count on
      // a confirmed write, and report a failure instead of discarding it.
      const { error } = await client.from('scheduled_workouts')
        .update({ planned_start_time: newTime })
        .eq('id', w.id)
        .eq('user_id', userId)
      if (error) {
        captureApiError('resolveCalendarConflicts.updateTime', error, { userId, workoutId: w.id })
      } else {
        // Keep the synced calendar event + local reminder pointed at the new time.
        await resyncMovedWorkout(client, userId, { ...w, planned_start_time: newTime })
        moved++
      }
    }
    occupied.push({ start: ns, end: new Date(ns.getTime() + w.planned_duration_min * 60_000) })
  }

  return moved
}

export interface CalendarConflict {
  workoutId: string
  focus: string
  plannedDate: string
  plannedStartTime: string
  plannedDurationMin: number
  /** The real calendar event's title, when the underlying provider gives us one. */
  eventTitle: string | null
}

// The free half of §24/§30 L2 — detects the exact same "a real event now
// overlaps this workout" condition resolveCalendarConflicts (Pro) resolves
// silently, but never writes anything. Uses getCalendarEventsForRange (titled
// DayEvents, the same source Home's own visible-day timeline reads) rather
// than gatherBusy's untitled BusySlots, specifically so the Home card this
// feeds can say what the conflict actually is ("clashes with Design review"),
// not just that one exists. Read-only by construction — there is no Pro gate
// to get wrong here, only a caller's choice to show or not show the result.
export async function findCalendarConflicts(client: SupabaseClient, userId: string): Promise<CalendarConflict[]> {
  const now = new Date()
  const today = startOfDay(now)
  const horizonEnd = new Date(today); horizonEnd.setDate(today.getDate() + HORIZON_DAYS)

  const { data: p } = await client
    .from('user_profiles')
    .select('scheduling_mode, selected_google_calendar_ids')
    .eq('user_id', userId)
    .maybeSingle()
  if (!p) return []
  if (!autoSchedulingEnabled(p)) return [] // manual: Tempo doesn't touch/flag their schedule

  const { data: workouts } = await client
    .from('scheduled_workouts')
    .select(MOVE_COLS)
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .gte('planned_date', toDateStr(today))
    .lte('planned_date', toDateStr(horizonEnd))
    .order('planned_date')
    .order('planned_start_time')
  if (!workouts?.length) return []

  const ignored = await getIgnoredEventKeys(client, userId)
  let events: DayEvent[] = []
  try {
    events = await getCalendarEventsForRange(today, horizonEnd, p.selected_google_calendar_ids as string[] | null)
  } catch {
    return [] // a calendar hiccup should never surface as a false conflict
  }

  const conflicts: CalendarConflict[] = []
  for (const w of workouts as WorkoutRow[]) {
    const start = new Date(`${w.planned_date}T${w.planned_start_time}`)
    const end = new Date(start.getTime() + w.planned_duration_min * 60_000)
    const hit = events.find((e) => {
      if (ignored.has(eventKey(e.start, e.end))) return false
      return start.getTime() < e.end.getTime() && e.start.getTime() < end.getTime()
    })
    if (hit) {
      conflicts.push({
        workoutId: w.id, focus: w.focus, plannedDate: w.planned_date,
        plannedStartTime: w.planned_start_time, plannedDurationMin: w.planned_duration_min,
        eventTitle: hit.title ?? null,
      })
    }
  }
  return conflicts
}
