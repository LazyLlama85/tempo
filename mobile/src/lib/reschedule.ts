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

export interface SlotSuggestion {
  date: string         // 'YYYY-MM-DD'
  start_time: string   // 'HH:MM:SS'
  label: string        // "Tomorrow at 7:00 AM"
  fromCalendar: boolean
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

// Suggest the next workout slot, honouring the user's availability (never during
// sleep/work/school) and how far their schedule_flexibility lets the workout move.
// Keeps one workout per day by blocking out days that already have one.
export async function suggestNextSlot(
  client: SupabaseClient,
  userId: string,
  durationMin: number,
): Promise<SlotSuggestion | null> {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

  const { data: p } = await client
    .from('user_profiles')
    .select('wake_time, bedtime, work_start, work_end, school_start, school_end, preferred_time_of_day, training_days, schedule_flexibility')
    .eq('user_id', userId)
    .maybeSingle()

  const horizon = FLEX_HORIZON[(p?.schedule_flexibility as string) ?? 'balanced'] ?? 4
  const availability: Availability = {
    wakeTime: p?.wake_time ?? null,
    bedtime: p?.bedtime ?? null,
    workStart: p?.work_start ?? null,
    workEnd: p?.work_end ?? null,
    schoolStart: p?.school_start ?? null,
    schoolEnd: p?.school_end ?? null,
    preferredTimeOfDay: (p?.preferred_time_of_day as Availability['preferredTimeOfDay']) ?? null,
    trainingDays: (p?.training_days as number[]) ?? [],
    unavailable: await getUnavailableBlocks(client, userId),
  }

  // Days that already hold a workout → block them out so we suggest a fresh day.
  const horizonEnd = new Date(tomorrow); horizonEnd.setDate(tomorrow.getDate() + horizon)
  const { data: existing } = await client
    .from('scheduled_workouts')
    .select('planned_date, status')
    .eq('user_id', userId)
    .gte('planned_date', toDateStr(today))
    .lte('planned_date', toDateStr(horizonEnd))
  const takenDays = new Set(
    (existing ?? [])
      .filter(w => w.status === 'scheduled' || w.status === 'completed')
      .map(w => w.planned_date as string),
  )

  const { busy, fromCalendar } = await gatherBusy(horizon, tomorrow)
  for (const ds of takenDays) {
    const d = new Date(`${ds}T00:00:00`)
    busy.push({ start: d, end: new Date(d.getTime() + 86_400_000) })
  }

  const slot = findVariedSlot(
    busy,
    availability,
    { durationMinutes: durationMin, bufferMinutes: 10 },
    { now: tomorrow, horizonDays: horizon, leadMinutes: 0, seed: today.getDate() },
  )
  if (!slot) return null

  const start = new Date(slot.startTime)
  const day = new Date(start); day.setHours(0, 0, 0, 0)
  return { date: toDateStr(start), start_time: fmtTime(start), label: labelFor(day, start), fromCalendar }
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
