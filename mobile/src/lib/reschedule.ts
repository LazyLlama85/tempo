// Tempo — smart rescheduling.
// When a workout is missed (or the user wants to move one), find the next open
// day and — if calendar access is granted — the next real free window on it.
// No-shame: a miss quietly becomes a new slot instead of a guilt trip.

import type { SupabaseClient } from '@supabase/supabase-js'
import { findFreeWindows, getCalendarPermissionStatus } from '@/services/calendarService'

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

// Next open day in the coming week with no scheduled/completed workout. Prefers
// a real free calendar window; otherwise falls back to a default morning time.
export async function suggestNextSlot(
  client: SupabaseClient,
  userId: string,
  durationMin: number,
  defaultTime = '07:00:00',
): Promise<SlotSuggestion | null> {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const horizonEnd = new Date(today); horizonEnd.setDate(today.getDate() + 8)

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

  const canRead = (await getCalendarPermissionStatus()) === 'granted'

  // Pass 1: prefer a real free window if we can read the calendar
  if (canRead) {
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i)
      if (takenDays.has(toDateStr(d))) continue
      const windows = await findFreeWindows(d, durationMin)
      if (windows.length) {
        const start = windows[0].start
        return { date: toDateStr(d), start_time: fmtTime(start), label: labelFor(d, start), fromCalendar: true }
      }
    }
  }

  // Pass 2: first open day at the default time
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i)
    if (takenDays.has(toDateStr(d))) continue
    const [h, m] = defaultTime.split(':').map(Number)
    const dt = new Date(d); dt.setHours(h, m, 0, 0)
    return { date: toDateStr(d), start_time: defaultTime, label: labelFor(d, dt), fromCalendar: false }
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
