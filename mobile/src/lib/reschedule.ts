// Tempo — smart rescheduling.
// When a workout is missed (or the user wants to move one), find the next open
// day and — if calendar access is granted — the next real free window on it.
// No-shame: a miss quietly becomes a new slot instead of a guilt trip.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getBusyBlocks, getCalendarPermissionStatus } from '@/services/calendarService'
import { isGoogleCalendarConnected } from '@/services/googleCalendar/CalendarAuthService'
import { fetchUserBusySlots } from '@/services/googleCalendar/CalendarApiService'
import { GCAL_PRIMARY } from '@/services/googleCalendar/config'
import { findVariedSlot, type Availability, type BusySlot } from '@/lib/smartSchedule'
import { getUnavailableBlocks } from '@/lib/unavailability'
import { getIgnoredEventKeys, filterIgnoredBusy } from '@/lib/ignoredEvents'
import { musclesToRegions, scoreDay, type Region, type DayLoad } from '@/lib/trainingLoad'
import { resyncMovedWorkout } from '@/lib/moveWorkout'
import { planWeekReschedule, RESCHEDULE_HORIZON_DAYS, type WeekWorkout } from '@/lib/weekReschedule'
import { fetchActiveSplit, isAutoSplit } from '@/lib/splits'
import { materializeSplit } from '@/lib/splitSchedule'
import type { CalendarProvider, TimeOfDay } from '@/types'

export interface SlotSuggestion {
  date: string         // 'YYYY-MM-DD'
  start_time: string   // 'HH:MM:SS'
  label: string        // "Tomorrow at 7:00 AM"
  fromCalendar: boolean
  reason?: string      // why this day — recovery/balance ("More recovery for legs")
}

// Movement pattern → coarse recovery region (complements the muscle-name mapping).
const PATTERN_REGION: Record<string, Region> = {
  push: 'push', pull: 'pull', squat: 'legs', hinge: 'legs', core: 'core', carry: 'core', cardio: 'other',
}

function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
}

function label12(d: Date): string {
  let h = d.getHours()
  const m = d.getMinutes()
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}

function labelFor(day: Date, dt: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000)
  const dayName = diff === 1 ? 'Tomorrow' : day.toLocaleDateString('en-US', { weekday: 'long' })
  return `${dayName} at ${label12(dt)}`
}

// How far Tempo may move a workout, by the user's schedule_flexibility:
//   strict   — keep it tight (next ~2 days),
//   balanced — within a few days,
//   flexible — anywhere in the coming week.
const FLEX_HORIZON: Record<string, number> = { strict: 2, balanced: 4, flexible: 7 }

// Busy blocks from whichever calendar is connected (Google preferred, else device).
// selected_google_calendar_ids stores only the calendars BEYOND primary (B1.5,
// see add_selected_calendars.sql) — primary always stays in the read.
async function gatherBusy(
  horizonDays: number,
  from: Date,
  selectedGoogleCalendarIds?: string[] | null,
): Promise<{ busy: BusySlot[]; fromCalendar: boolean }> {
  const calendarIds = selectedGoogleCalendarIds?.length
    ? [GCAL_PRIMARY, ...selectedGoogleCalendarIds.filter(id => id !== GCAL_PRIMARY)]
    : undefined
  try {
    if (await isGoogleCalendarConnected()) {
      return { busy: await fetchUserBusySlots(horizonDays, calendarIds), fromCalendar: true }
    }
  } catch { /* fall through to device */ }
  try {
    if ((await getCalendarPermissionStatus()) === 'granted') {
      const busy: BusySlot[] = []
      for (let i = 0; i < horizonDays; i++) {
        const d = new Date(from); d.setDate(from.getDate() + i)
        busy.push(...await getBusyBlocks(d))
      }
      return { busy, fromCalendar: true }
    }
  } catch { /* no calendar access */ }
  return { busy: [], fromCalendar: false }
}

function isoWeekday(d: Date): number { return ((d.getDay() + 6) % 7) + 1 }

// Suggest the next workout slot — but like a coach, not a calendar. It honours the
// user's availability (never during sleep/work/school), respects how far their
// schedule_flexibility lets a workout move, keeps one workout per day, AND prefers
// the day that gives the best recovery: it avoids stacking the same muscle region on
// back-to-back days and breaking the week into a 3-in-a-row grind. Pass the moving
// workout's id so its muscles inform the choice (without it, falls back to "soonest").
export async function suggestNextSlot(
  client: SupabaseClient,
  userId: string,
  durationMin: number,
  movingWorkoutId?: string,
): Promise<SlotSuggestion | null> {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

  const { data: p } = await client
    .from('user_profiles')
    .select('wake_time, bedtime, work_start, work_end, school_start, school_end, preferred_time_of_day, training_days, schedule_flexibility, selected_google_calendar_ids')
    .eq('user_id', userId)
    .maybeSingle()

  const horizon = FLEX_HORIZON[(p?.schedule_flexibility as string) ?? 'balanced'] ?? 4
  const allowDays = new Set((p?.training_days as number[]) ?? [])
  const availability: Availability = {
    wakeTime: p?.wake_time ?? null,
    bedtime: p?.bedtime ?? null,
    workStart: p?.work_start ?? null,
    workEnd: p?.work_end ?? null,
    schoolStart: p?.school_start ?? null,
    schoolEnd: p?.school_end ?? null,
    preferredTimeOfDay: (p?.preferred_time_of_day as Availability['preferredTimeOfDay']) ?? null,
    // We pick the DAY ourselves below (recovery-aware), so don't let findVariedSlot's
    // own day filter override it — we only ask it to place the TIME on a given day.
    trainingDays: [],
    unavailable: await getUnavailableBlocks(client, userId),
  }

  // Look back two days too, so the recovery check can see a session that already
  // happened (e.g. yesterday's legs) when scoring the next few days.
  const horizonEnd = new Date(tomorrow); horizonEnd.setDate(tomorrow.getDate() + horizon)
  const lookback = new Date(today); lookback.setDate(today.getDate() - 2)
  const { data: existing } = await client
    .from('scheduled_workouts')
    .select('id, planned_date, status, exercise_ids')
    .eq('user_id', userId)
    .gte('planned_date', toDateStr(lookback))
    .lte('planned_date', toDateStr(horizonEnd))

  const rows = (existing ?? []) as { id: string; planned_date: string; status: string; exercise_ids: string[] | null }[]

  // Days that already hold a (future) workout → block them so we suggest a fresh day.
  const takenDays = new Set(
    rows
      .filter(w => (w.status === 'scheduled' || w.status === 'completed') && w.planned_date >= toDateStr(today))
      .map(w => w.planned_date),
  )

  // Resolve every involved exercise's muscle regions in one query.
  const movingRow = movingWorkoutId ? rows.find(r => r.id === movingWorkoutId) : undefined
  const allExIds = [...new Set(rows.flatMap(r => r.exercise_ids ?? []))]
  const exRegion = new Map<string, Region[]>()
  if (allExIds.length) {
    const { data: exRows } = await client
      .from('exercises')
      .select('id, primary_muscles, secondary_muscles, movement_pattern')
      .in('id', allExIds)
    for (const e of (exRows ?? []) as any[]) {
      const regions = musclesToRegions([...(e.primary_muscles ?? []), ...(e.secondary_muscles ?? [])])
      const pr = PATTERN_REGION[e.movement_pattern as string]
      if (pr) regions.add(pr)
      exRegion.set(e.id as string, [...regions])
    }
  }
  const regionsOf = (ids: string[] | null | undefined): Set<Region> => {
    const out = new Set<Region>()
    for (const id of ids ?? []) for (const r of exRegion.get(id) ?? []) out.add(r)
    return out
  }

  const movingRegions = regionsOf(movingRow?.exercise_ids)
  // The week's training load (real sessions only), excluding the workout being moved.
  const loads: DayLoad[] = rows
    .filter(w => (w.status === 'scheduled' || w.status === 'completed') && w.id !== movingWorkoutId)
    .map(w => ({ date: w.planned_date, regions: regionsOf(w.exercise_ids) }))

  // Rank candidate days by recovery score (then soonest), instead of just taking the
  // first open day. This is the heart of "smart" rescheduling.
  const candidates: { day: Date; score: number; reason: string }[] = []
  for (let off = 1; off <= horizon; off++) {
    const day = new Date(today); day.setDate(today.getDate() + off)
    const ds = toDateStr(day)
    if (takenDays.has(ds)) continue
    if (allowDays.size && !allowDays.has(isoWeekday(day))) continue
    const { score, reason } = scoreDay(day, movingRegions, loads)
    candidates.push({ day, score, reason })
  }
  candidates.sort((a, b) => a.score - b.score || a.day.getTime() - b.day.getTime())

  const { busy: rawBusy, fromCalendar } = await gatherBusy(horizon, tomorrow, p?.selected_google_calendar_ids as string[] | null)
  // Events the user crossed off ("ignore") don't block — let workouts use that time.
  const busy = filterIgnoredBusy(rawBusy, await getIgnoredEventKeys(client, userId))

  // Try days best-recovery-first; the first one with a real opening wins.
  for (const c of candidates) {
    const slot = findVariedSlot(
      busy,
      availability,
      { durationMinutes: durationMin, bufferMinutes: 10 },
      { now: c.day, horizonDays: 1, leadMinutes: 0, seed: c.day.getDate() },
    )
    if (!slot) continue
    const start = new Date(slot.startTime)
    const day = new Date(start); day.setHours(0, 0, 0, 0)
    return { date: toDateStr(start), start_time: fmtTime(start), label: labelFor(day, start), fromCalendar, reason: c.reason }
  }
  return null
}

// A calendar-aware TIME on a specific day the user already chose (the manual
// "Add workout" flow): the same free-slot engine auto-scheduling uses, scoped to
// one date — so even fully manual scheduling gets "6:30 PM, you're free" instead
// of a dumb 7:00 AM default. Returns null when nothing is known about the day or
// it's genuinely full.
export async function suggestTimeOnDate(
  client: SupabaseClient,
  userId: string,
  dateStr: string,        // 'YYYY-MM-DD'
  durationMin: number,
): Promise<{ start_time: string; fromCalendar: boolean } | null> {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const day = new Date(`${dateStr}T00:00:00`)
    if (Number.isNaN(day.getTime()) || day.getTime() < today.getTime()) return null
    const isToday = day.getTime() === today.getTime()

    const { data: p } = await client
      .from('user_profiles')
      .select('wake_time, bedtime, work_start, work_end, school_start, school_end, preferred_time_of_day, selected_google_calendar_ids')
      .eq('user_id', userId)
      .maybeSingle()

    const availability: Availability = {
      wakeTime: p?.wake_time ?? null,
      bedtime: p?.bedtime ?? null,
      workStart: p?.work_start ?? null,
      workEnd: p?.work_end ?? null,
      schoolStart: p?.school_start ?? null,
      schoolEnd: p?.school_end ?? null,
      preferredTimeOfDay: (p?.preferred_time_of_day as Availability['preferredTimeOfDay']) ?? null,
      trainingDays: [],   // the user picked this day deliberately — don't veto it
      unavailable: await getUnavailableBlocks(client, userId),
    }

    const horizon = Math.max(1, Math.round((day.getTime() - today.getTime()) / 86_400_000) + 1)
    const { busy: rawBusy, fromCalendar } = await gatherBusy(horizon, today, p?.selected_google_calendar_ids as string[] | null)
    const busy = filterIgnoredBusy(rawBusy, await getIgnoredEventKeys(client, userId))

    const slot = findVariedSlot(
      busy,
      availability,
      { durationMinutes: Math.max(15, durationMin), bufferMinutes: 10 },
      { now: isToday ? new Date() : day, horizonDays: 1, leadMinutes: isToday ? 30 : 0, seed: day.getDate() },
    )
    if (!slot) return null
    return { start_time: fmtTime(new Date(slot.startTime)), fromCalendar }
  } catch {
    return null
  }
}

// Move a workout to the suggested slot and record an adaptation event for the
// audit trail. Calendar event re-sync (if any) is handled by the caller.
export async function rescheduleWorkout(
  client: SupabaseClient,
  userId: string,
  workoutId: string,
  slot: SlotSuggestion,
): Promise<void> {
  // Supabase returns { error } rather than throwing — this used to be
  // destructured and discarded, so a failed write (offline, RLS) left the UI
  // showing the workout "moved" while the DB row never changed. Throwing here
  // routes the failure through the caller's existing try/catch (index.tsx's
  // confirmMoveWorkout already shows a real "Could not reschedule" alert).
  const { error } = await client
    .from('scheduled_workouts')
    .update({ planned_date: slot.date, planned_start_time: slot.start_time, status: 'scheduled' })
    .eq('id', workoutId)
    .eq('user_id', userId)
  if (error) throw error

  try {
    await client.from('adaptation_events').insert({
      user_id: userId,
      trigger: 'missed_workout',
      trigger_details: { workout_id: workoutId, to_date: slot.date, from_calendar: slot.fromCalendar },
      action_taken: 'rescheduled',
    })
  } catch {
    // Audit log is best-effort — never block a reschedule on it
  }
}

// ── B1.3a — "Reschedule my whole week" ──────────────────────────────────────
// The payable magic: when real life upends the week (a trip, a new shift, a busy
// stretch), re-lay EVERY upcoming session at once — best DAY (recovery-aware, on
// allowed training days, around the real calendar) AND calendar-aware TIME for each,
// in a single action. Unlike `autoScheduleUpcoming` (day-preserving, time-only),
// this reassigns the DAY too. The pure day/time planner lives in `weekReschedule.ts`
// (unit-tested in isolation); `rescheduleWholeWeek` below wraps it with DB + calendar
// I/O. A reschedule never *drops* a session — an unplaceable workout keeps its slot.

interface WeekRow {
  id: string
  focus: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number
  status: string
  exercise_ids: string[] | null
  calendar_event_id: string | null
  calendar_provider: CalendarProvider | null
}

// One call re-slots the whole upcoming week. Runs on the user's explicit request,
// so — unlike the automatic re-slotters — it works even in `manual` scheduling mode.
// Returns how many sessions actually moved out of how many were eligible.
export async function rescheduleWholeWeek(
  client: SupabaseClient,
  userId: string,
): Promise<{ moved: number; total: number }> {
  const now = new Date()
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const horizon = RESCHEDULE_HORIZON_DAYS
  const lookback = new Date(today); lookback.setDate(today.getDate() - 2)
  const contextEnd = new Date(today); contextEnd.setDate(today.getDate() + 14)
  const windowEnd = new Date(today); windowEnd.setDate(today.getDate() + horizon - 1)

  const { data: p } = await client
    .from('user_profiles')
    .select('wake_time, bedtime, work_start, work_end, school_start, school_end, preferred_time_of_day, training_days, preferred_calendar, selected_google_calendar_ids')
    .eq('user_id', userId)
    .maybeSingle()

  const availability: Availability = {
    wakeTime: p?.wake_time ?? null,
    bedtime: p?.bedtime ?? null,
    workStart: p?.work_start ?? null,
    workEnd: p?.work_end ?? null,
    schoolStart: p?.school_start ?? null,
    schoolEnd: p?.school_end ?? null,
    preferredTimeOfDay: (p?.preferred_time_of_day as Availability['preferredTimeOfDay']) ?? null,
    // The planner picks the DAY itself (recovery-aware), so keep findVariedSlot's own
    // day filter open — it only places the TIME on the day we hand it.
    trainingDays: [],
    unavailable: await getUnavailableBlocks(client, userId),
  }
  const allowDays = new Set((p?.training_days as number[]) ?? [])

  // Re-lay a whole week that's missing a day the active split actually owns —
  // a workout the user removed one day (status 'skipped') or that never got
  // materialized — BEFORE re-slotting, so "reschedule my week" also repairs a
  // week that's short a session instead of only shuffling what's already there.
  // Idempotent + a no-op when there's no active (or auto-mirror) split.
  try {
    const active = await fetchActiveSplit(client, userId)
    if (active && !isAutoSplit(active)) {
      await materializeSplit(client, userId, active, (p?.preferred_time_of_day as TimeOfDay | null) ?? null)
    }
  } catch {
    // Best-effort — a failure here shouldn't block the re-slot pass below.
  }

  const { data: rows } = await client
    .from('scheduled_workouts')
    .select('id, focus, planned_date, planned_start_time, planned_duration_min, status, exercise_ids, calendar_event_id, calendar_provider')
    .eq('user_id', userId)
    .gte('planned_date', toDateStr(lookback))
    .lte('planned_date', toDateStr(contextEnd))
    .order('planned_date')
    .order('planned_start_time')

  const all = (rows ?? []) as WeekRow[]

  // Resolve every involved exercise's muscle regions in one query.
  const allExIds = [...new Set(all.flatMap(r => r.exercise_ids ?? []))]
  const exRegion = new Map<string, Region[]>()
  if (allExIds.length) {
    const { data: exRows } = await client
      .from('exercises')
      .select('id, primary_muscles, secondary_muscles, movement_pattern')
      .in('id', allExIds)
    for (const e of (exRows ?? []) as any[]) {
      const regions = musclesToRegions([...(e.primary_muscles ?? []), ...(e.secondary_muscles ?? [])])
      const pr = PATTERN_REGION[e.movement_pattern as string]
      if (pr) regions.add(pr)
      exRegion.set(e.id as string, [...regions])
    }
  }
  const regionsOf = (ids: string[] | null | undefined): Set<Region> => {
    const s = new Set<Region>()
    for (const id of ids ?? []) for (const r of exRegion.get(id) ?? []) s.add(r)
    return s
  }

  const todayStr = toDateStr(today)
  const windowEndStr = toDateStr(windowEnd)
  const movableRows = all.filter(r => r.status === 'scheduled' && r.planned_date >= todayStr && r.planned_date <= windowEndStr)
  if (!movableRows.length) return { moved: 0, total: 0 }

  const movable: WeekWorkout[] = movableRows.map(r => ({
    id: r.id,
    regions: regionsOf(r.exercise_ids),
    durationMin: r.planned_duration_min,
    date: r.planned_date,
    startTime: r.planned_start_time,
  }))

  // Fixed sessions that must stay put but still shape recovery: recent completed
  // sessions + any scheduled workout beyond this week's window (next week's plan).
  const movableIds = new Set(movableRows.map(r => r.id))
  const priorLoads: DayLoad[] = all
    .filter(r => !movableIds.has(r.id) && (r.status === 'completed' || r.status === 'scheduled'))
    .map(r => ({ date: r.planned_date, regions: regionsOf(r.exercise_ids) }))

  const { busy: rawBusy } = await gatherBusy(horizon, today, p?.selected_google_calendar_ids as string[] | null)
  const busy = filterIgnoredBusy(rawBusy, await getIgnoredEventKeys(client, userId))

  const assignments = planWeekReschedule(movable, busy, availability, priorLoads, { now, horizonDays: horizon, allowDays })

  const rowById = new Map(movableRows.map(r => [r.id, r]))
  let moved = 0
  for (const a of assignments) {
    if (!a.changed) continue
    const r = rowById.get(a.id)
    if (!r) continue
    await client
      .from('scheduled_workouts')
      .update({ planned_date: a.date, planned_start_time: a.start_time, status: 'scheduled' })
      .eq('id', a.id)
      .eq('user_id', userId)
    // Keep the synced calendar event + local reminder pointed at the new day/time.
    await resyncMovedWorkout(client, userId, {
      id: r.id,
      focus: r.focus,
      planned_date: a.date,
      planned_start_time: a.start_time,
      planned_duration_min: r.planned_duration_min,
      calendar_event_id: r.calendar_event_id,
      calendar_provider: r.calendar_provider,
    })
    moved++
  }

  if (moved > 0) {
    try {
      await client.from('adaptation_events').insert({
        user_id: userId,
        trigger: 'reschedule_week',
        trigger_details: { moved, total: movable.length },
        action_taken: 'rescheduled',
      })
    } catch {
      // Audit log is best-effort — never block the reschedule on it
    }
  }

  return { moved, total: movable.length }
}
