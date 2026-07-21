// Tempo — pause / vacation mode (PRODUCT_AUDIT.html §26, L21).
//
// "I'm away for 10 days." Today that produces a broken streak, a wall of
// 'missed' sessions, and a plan that's silently drifted — because nothing tells
// Tempo the user is gone. Pausing shifts every future scheduled_workouts row
// forward by N days (calendar events + reminders move with them, via the same
// resyncMovedWorkout the auto-scheduler already uses for single-row moves), then
// records the return date. Resuming early shifts the still-unrealized remainder
// back. week_index is never touched — the mesocycle resumes exactly where it
// left off. See streak.ts: because paused days simply never get a
// scheduled_workouts row in range, they never enter the streak's day map, so the
// streak survives a pause with no special-casing.

import type { SupabaseClient } from '@supabase/supabase-js'
import { toDateStr } from '@/lib/dates'
import { resyncMovedWorkout, type MovableWorkout } from '@/lib/moveWorkout'

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

interface ShiftRow {
  id: string
  focus: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number
  calendar_event_id: string | null
  calendar_provider: 'google' | 'device' | null
}

const SHIFT_COLS = 'id, focus, planned_date, planned_start_time, planned_duration_min, calendar_event_id, calendar_provider'

// Shift every future 'scheduled' row by `days` (positive = later, negative =
// earlier), re-pointing each moved row's synced calendar event + reminder.
// Rows are shifted one at a time (never in bulk SQL) specifically so each one
// routes through resyncMovedWorkout — a bulk UPDATE would silently leave stale
// calendar events/reminders behind. Bounded by the pause horizon (~60 days max),
// so this is at most a few dozen rows.
async function shiftFutureWorkouts(
  client: SupabaseClient,
  userId: string,
  fromDate: string,
  days: number,
): Promise<number> {
  if (days === 0) return 0
  const { data } = await client
    .from('scheduled_workouts')
    .select(SHIFT_COLS)
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .gte('planned_date', fromDate)
  const rows = (data ?? []) as ShiftRow[]
  let moved = 0
  for (const r of rows) {
    const newDate = addDaysStr(r.planned_date, days)
    const { error } = await client
      .from('scheduled_workouts')
      .update({ planned_date: newDate })
      .eq('id', r.id)
      .eq('user_id', userId)
    if (error) continue
    moved++
    const movable: MovableWorkout = {
      id: r.id,
      focus: r.focus,
      planned_date: newDate,
      planned_start_time: r.planned_start_time,
      planned_duration_min: r.planned_duration_min,
      calendar_event_id: r.calendar_event_id,
      calendar_provider: r.calendar_provider,
    }
    await resyncMovedWorkout(client, userId, movable)
  }
  return moved
}

export interface PauseResult {
  ok: boolean
  shifted: number
}

// Pause starting today through `days` days from now (inclusive). Any of today's
// own not-yet-completed session gets pushed too — going on vacation "starting
// now" reasonably includes the rest of today.
export async function pausePlan(client: SupabaseClient, userId: string, days: number): Promise<PauseResult> {
  const today = toDateStr(new Date())
  const until = addDaysStr(today, days)
  const shifted = await shiftFutureWorkouts(client, userId, today, days)
  const { error } = await client.from('user_profiles').update({ paused_until: until }).eq('user_id', userId)
  if (error) return { ok: false, shifted: 0 }
  return { ok: true, shifted }
}

// Resume early: shift the still-unrealized remainder back, then clear the flag.
// Safe to call even if paused_until has already passed (remaining <= 0 → no shift).
export async function resumePlan(client: SupabaseClient, userId: string, pausedUntil: string): Promise<PauseResult> {
  const today = toDateStr(new Date())
  const remaining = Math.round(
    (new Date(`${pausedUntil}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
  )
  const shifted = remaining > 0 ? await shiftFutureWorkouts(client, userId, today, -remaining) : 0
  const { error } = await client.from('user_profiles').update({ paused_until: null }).eq('user_id', userId)
  if (error) return { ok: false, shifted: 0 }
  return { ok: true, shifted }
}

// Time simply passing needs no date shift (everything already landed in the
// right place) — just clear the now-stale flag. Best-effort, called once on
// app-open alongside the other sweeps.
export async function checkPauseExpiry(client: SupabaseClient, userId: string, pausedUntil: string | null | undefined): Promise<boolean> {
  if (!pausedUntil) return false
  if (toDateStr(new Date()) < pausedUntil) return false
  const { error } = await client.from('user_profiles').update({ paused_until: null }).eq('user_id', userId)
  return !error
}

// 'YYYY-MM-DD' → "March 3" for banners/settings.
export function describePauseUntil(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}
