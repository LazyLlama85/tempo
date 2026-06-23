// Tempo — smart rescheduling.
// When a workout is missed (or the user wants to move one), find the next open
// day and — if calendar access is granted — the next real free window on it.
// No-shame: a miss quietly becomes a new slot instead of a guilt trip.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getBusyBlocks, getCalendarPermissionStatus } from '@/services/calendarService'
import { isGoogleCalendarConnected } from '@/services/googleCalendar/CalendarAuthService'
import { fetchUserBusySlots } from '@/services/googleCalendar/CalendarApiService'
import { findVariedSlot, type Availability, type BusySlot } from '@/lib/smartSchedule'
import { getUnavailableBlocks } from '@/lib/unavailability'
import { musclesToRegions, scoreDay, type Region, type DayLoad } from '@/lib/trainingLoad'

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
async function gatherBusy(horizonDays: number, from: Date): Promise<{ busy: BusySlot[]; fromCalendar: boolean }> {
  try {
    if (await isGoogleCalendarConnected()) {
      return { busy: await fetchUserBusySlots(horizonDays), fromCalendar: true }
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
    .select('wake_time, bedtime, work_start, work_end, school_start, school_end, preferred_time_of_day, training_days, schedule_flexibility')
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

  const { busy, fromCalendar } = await gatherBusy(horizon, tomorrow)

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

// Move a workout to the suggested slot and record an adaptation event for the
// audit trail. Calendar event re-sync (if any) is handled by the caller.
export async function rescheduleWorkout(
  client: SupabaseClient,
  userId: string,
  workoutId: string,
  slot: SlotSuggestion,
): Promise<void> {
  await client
    .from('scheduled_workouts')
    .update({ planned_date: slot.date, planned_start_time: slot.start_time, status: 'scheduled' })
    .eq('id', workoutId)
    .eq('user_id', userId)

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
