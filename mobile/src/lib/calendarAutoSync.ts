// Tempo — calendar auto-sync.
//
// Replaces the old manual "Smart Schedule My Week" button with a simple promise:
// when auto-sync is on (default) AND a calendar is connected, scheduled workouts
// are added to the user's calendar automatically. This runs a best-effort sweep
// that only touches upcoming workouts not yet on a calendar, so it's safe to call
// on app open and after scheduling.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserProfile } from '@/types'
import {
  addWorkoutToCalendar, removeWorkoutFromCalendar, getConnectedProviders, type SyncWorkout,
} from '@/services/calendarSync'
import { deleteTempoDeviceEvents } from '@/services/calendarService'
import { deleteTempoGoogleEvents } from '@/services/googleCalendar/CalendarApiService'

// Adding workouts to a calendar is OPT-IN: off unless the user explicitly turned it
// on. Connecting a calendar (for reading busy times) does NOT enable this — Tempo
// never writes to someone's calendar without a deliberate yes.
export function autoSyncEnabled(profile: UserProfile | null | undefined): boolean {
  return profile?.calendar_autosync === true
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Add upcoming, not-yet-synced workouts to the connected calendar. No-op when
// auto-sync is off or nothing is connected. Returns how many it added.
export async function syncUpcomingWorkouts(
  client: SupabaseClient,
  userId: string,
  profile: UserProfile | null | undefined,
): Promise<number> {
  if (!userId || !autoSyncEnabled(profile)) return 0
  const connected = await getConnectedProviders().catch(() => ({ google: false, device: false }))
  if (!connected.google && !connected.device) return 0

  const { data } = await client
    .from('scheduled_workouts')
    .select('id, focus, planned_date, planned_start_time, planned_duration_min, calendar_event_id, calendar_provider')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .is('calendar_event_id', null)
    .gte('planned_date', todayStr())
    .order('planned_date')
    .limit(30)

  const rows = (data ?? []) as SyncWorkout[]
  let added = 0
  for (const w of rows) {
    const res = await addWorkoutToCalendar(client, w, userId, profile?.preferred_calendar ?? null)
    if (res.ok) added++
    // If we suddenly can't write (permission revoked / disconnected), stop early
    // rather than hammering a dozen failing requests.
    else if (res.reason === 'none_connected' || res.reason === 'permission_denied') break
  }
  return added
}

// Remove EVERY Tempo-added event from the user's calendar(s) and clear the pointers.
// Called when the user turns "add workouts to calendar" OFF — their calendar should
// return to exactly how it was, with no Tempo events left behind. Best-effort per
// row (removeWorkoutFromCalendar clears the DB pointer even if the calendar delete
// fails, so the app never shows a stale "In Calendar"). Returns how many it cleared
// out of how many it attempted — `total` lets a caller (settings.tsx's autosync
// toggle) tell "nothing to remove" apart from "some removals actually failed,"
// which a bare count can't (this never throws — each row's own try/catch means a
// failure only shows up as `removed < total`, not a rejected promise).
export async function purgeSyncedWorkouts(client: SupabaseClient, userId: string): Promise<{ removed: number; total: number }> {
  if (!userId) return { removed: 0, total: 0 }
  const { data } = await client
    .from('scheduled_workouts')
    .select('id, focus, planned_date, planned_start_time, planned_duration_min, calendar_event_id, calendar_provider')
    .eq('user_id', userId)
    .not('calendar_event_id', 'is', null)

  const rows = (data ?? []) as SyncWorkout[]
  let removed = 0
  for (const w of rows) {
    try { await removeWorkoutFromCalendar(client, w, userId); removed++ } catch { /* best-effort */ }
  }
  return { removed, total: rows.length }
}

// Nuke EVERY Tempo event from the user's calendar(s) — the "remove all Tempo
// instances" button. Broader than purgeSyncedWorkouts: after removing the events we
// still track, it sweeps each connected calendar by Tempo's title/color across a
// wide window so orphaned events (left behind by a reinstall, a manual DB edit, or a
// half-finished sync) are cleaned up too, then clears any lingering DB pointers.
// Returns roughly how many events were removed.
export async function removeAllTempoEvents(client: SupabaseClient, userId: string): Promise<number> {
  if (!userId) return 0

  // 1) Delete events we still have pointers to (also handles ones the user renamed,
  //    since these delete by id) and clear those pointers.
  let removed = (await purgeSyncedWorkouts(client, userId).catch(() => ({ removed: 0, total: 0 }))).removed

  // 2) Title/color sweep for orphans on whatever calendar is connected. Wide window
  //    (±18 months) so old and future events are both caught.
  const connected = await getConnectedProviders().catch(() => ({ google: false, device: false }))
  const start = new Date(); start.setMonth(start.getMonth() - 18); start.setHours(0, 0, 0, 0)
  const end = new Date(); end.setMonth(end.getMonth() + 18); end.setHours(23, 59, 59, 999)

  if (connected.google) {
    try { removed += await deleteTempoGoogleEvents(start, end) } catch { /* best-effort */ }
  }
  if (connected.device) {
    try { removed += await deleteTempoDeviceEvents(start, end) } catch { /* best-effort */ }
  }

  // 3) Belt-and-braces: clear any pointer still set, so nothing reads "In Calendar".
  try {
    await client
      .from('scheduled_workouts')
      .update({ calendar_event_id: null, calendar_provider: null })
      .eq('user_id', userId)
      .not('calendar_event_id', 'is', null)
  } catch { /* best-effort */ }

  return removed
}
