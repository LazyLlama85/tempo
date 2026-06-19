// Tempo — unified calendar sync (the single front door for workout ↔ calendar).
//
// The app supports TWO calendars: the on-device calendar (expo-calendar) and the
// user's Google Calendar (REST API). Callers shouldn't care which is in play.
// New events go to the user's PREFERRED provider when it's connected, otherwise
// to whichever one is. Each workout records the provider its event landed in
// (scheduled_workouts.calendar_provider) so removal always targets the right
// calendar — that's what prevents ghost / orphaned events when both are set up.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CalendarProvider } from '@/types'
import {
  createDeviceEvent, deleteDeviceEvent, getCalendarPermissionStatus,
} from './calendarService'
import { isGoogleCalendarConnected } from './googleCalendar/CalendarAuthService'
import { autoScheduleWorkout, deleteCalendarEvent } from './googleCalendar/CalendarApiService'

export interface SyncWorkout {
  id: string
  focus: string
  planned_date: string         // 'YYYY-MM-DD'
  planned_start_time: string   // 'HH:MM:SS'
  planned_duration_min: number
  calendar_event_id: string | null
  calendar_provider: CalendarProvider | null
}

export interface ConnectedProviders {
  google: boolean
  device: boolean
}

export type AddResult =
  | { ok: true; provider: CalendarProvider; eventId: string }
  | { ok: false; reason: 'none_connected' | 'permission_denied' | 'error' }

// Which calendars can we write to right now? Both checks fail-soft to false.
export async function getConnectedProviders(): Promise<ConnectedProviders> {
  const [google, deviceStatus] = await Promise.all([
    isGoogleCalendarConnected().catch(() => false),
    getCalendarPermissionStatus().catch(() => 'undetermined' as const),
  ])
  return { google, device: deviceStatus === 'granted' }
}

// Decide where a NEW event should go: the preferred provider if connected,
// otherwise the other connected one, otherwise null (nothing connected).
export function resolveTarget(
  preferred: CalendarProvider | null,
  connected: ConnectedProviders,
): CalendarProvider | null {
  if (preferred === 'google' && connected.google) return 'google'
  if (preferred === 'device' && connected.device) return 'device'
  if (connected.google) return 'google'
  if (connected.device) return 'device'
  return null
}

// 'YYYY-MM-DD' + 'HH:MM:SS' parsed as LOCAL time (no trailing Z → no UTC shift).
function localStart(workout: SyncWorkout): Date {
  return new Date(`${workout.planned_date}T${workout.planned_start_time}`)
}

// Add the workout to the resolved calendar and persist its event id + provider.
export async function addWorkoutToCalendar(
  client: SupabaseClient,
  workout: SyncWorkout,
  userId: string,
  preferred: CalendarProvider | null,
): Promise<AddResult> {
  const connected = await getConnectedProviders()
  const target = resolveTarget(preferred, connected)
  if (!target) return { ok: false, reason: 'none_connected' }

  try {
    let eventId: string | null
    if (target === 'google') {
      const ev = await autoScheduleWorkout(
        `Tempo · ${workout.focus}`, localStart(workout), workout.planned_duration_min,
      )
      eventId = ev.id
    } else {
      eventId = await createDeviceEvent(workout)
      if (!eventId) return { ok: false, reason: 'permission_denied' }
    }
    if (!eventId) return { ok: false, reason: 'error' }

    await client
      .from('scheduled_workouts')
      .update({ calendar_event_id: eventId, calendar_provider: target })
      .eq('id', workout.id)
      .eq('user_id', userId)

    return { ok: true, provider: target, eventId }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

// Remove the workout's event from whichever calendar it lives in, then clear the
// DB pointer. Legacy events with no recorded provider default to device (the
// original behaviour). Missing/already-deleted events are treated as success.
export async function removeWorkoutFromCalendar(
  client: SupabaseClient,
  workout: SyncWorkout,
  userId: string,
): Promise<void> {
  const eventId = workout.calendar_event_id
  if (eventId) {
    const provider = workout.calendar_provider ?? 'device'
    try {
      if (provider === 'google') await deleteCalendarEvent(eventId)
      else await deleteDeviceEvent(eventId)
    } catch {
      // Best-effort — still clear the pointer below so the UI never gets stuck.
    }
  }
  await client
    .from('scheduled_workouts')
    .update({ calendar_event_id: null, calendar_provider: null })
    .eq('id', workout.id)
    .eq('user_id', userId)
}
