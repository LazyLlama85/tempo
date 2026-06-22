// Tempo — CalendarApiService: the smart-scheduling engine.
//
// Talks to the Google Calendar REST API directly from the client, using a valid
// access token from CalendarAuthService. Three responsibilities:
//   • fetchUserBusySlots()   — read the user's real agenda for the week ahead.
//   • findBestWorkoutSlot()  — PURE algorithm: given busy slots + constraints,
//                              return the best open slot. No I/O → easy to test.
//   • autoScheduleWorkout()  — write the chosen workout back as a tomato-red event.
//
// The gap-finding core is ported from the device-calendar engine
// (services/calendarService.ts → findFreeWindows) so both paths behave the same.

import { getGoogleAccessToken, invalidateGoogleAccessToken } from './CalendarAuthService'
import { eventsEndpoint, WORKOUT_EVENT_COLOR_ID } from './config'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BusySlot {
  start: Date
  end: Date
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening'

export interface SchedulingConstraints {
  durationMinutes: number
  timeOfDayPreference?: TimeOfDay
  workoutGoal?: string // e.g. 'Cardio', 'Strength Training'
}

export interface ScheduledSlot {
  startTime: string // ISO 8601 — the spec's "optimal available startTime date-string"
  endTime: string   // ISO 8601
}

export interface FindSlotOptions {
  now?: Date
  horizonDays?: number  // how many days ahead to consider (default 7)
  leadMinutes?: number  // don't book sooner than this from now (default 60)
}

export interface CalendarEvent {
  id: string
  htmlLink?: string
  status?: string
  colorId?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

interface GoogleEvent {
  id: string
  status?: string
  summary?: string
  colorId?: string
  transparency?: 'opaque' | 'transparent'
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

// ── Heuristics (soft, transparent — not pseudo-science) ──────────────────────────

// Waking hours we'll ever place a workout in.
const FULL_DAY: [number, number] = [6, 21]

const TIME_WINDOWS: Record<TimeOfDay, [number, number]> = {
  morning: [6, 12],
  afternoon: [12, 17],
  evening: [17, 21],
}

// When the user hasn't picked a time of day, fall back to a sensible default per
// goal (e.g. cardio reads better in the morning, lifting later). Just a default —
// an explicit timeOfDayPreference always wins.
function defaultWindowForGoal(goal?: string): TimeOfDay {
  const g = (goal ?? '').toLowerCase()
  if (g.includes('cardio')) return 'morning'
  if (g.includes('strength')) return 'evening'
  return 'morning'
}

// Leave a little breathing room *after* the session (cool down / shower) so we
// don't butt a workout right up against the user's next meeting. Slightly more
// for strength work. This pads the gap we require, not the event length.
function bufferForGoal(goal?: string): number {
  const g = (goal ?? '').toLowerCase()
  return g.includes('strength') ? 15 : 10
}

// ── 1) Read the week's agenda from the 'primary' calendar ───────────────────────

export async function fetchUserBusySlots(daysAhead = 7): Promise<BusySlot[]> {
  const now = new Date()
  const timeMax = new Date(now.getTime() + daysAhead * 86_400_000)

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',   // expand recurring events into real instances
    orderBy: 'startTime',   // requires singleEvents
    maxResults: '250',
  })

  const resp = await gcalFetch(`${eventsEndpoint()}?${params.toString()}`, { method: 'GET' })
  if (!resp.ok) throw new Error(`gcal_fetch_failed_${resp.status}`)

  const data = await resp.json()
  const items = (data.items ?? []) as GoogleEvent[]

  return items
    // Timed events only (skip all-day), skip ones the user marked "free", skip
    // cancelled, and skip Tempo's own workouts (colorId 11) — those are tracked
    // as scheduled_workouts, so counting them here would double-book / double-show.
    .filter(e =>
      !!e.start?.dateTime && !!e.end?.dateTime &&
      e.transparency !== 'transparent' && e.status !== 'cancelled' &&
      e.colorId !== WORKOUT_EVENT_COLOR_ID)
    .map(e => ({ start: new Date(e.start!.dateTime!), end: new Date(e.end!.dateTime!) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

// ── 1b) Read titled events for the home timeline ────────────────────────────────
//
// Same source as fetchUserBusySlots, but keeps event *titles* so a user's real
// Google events render on the dashboard alongside (and behind) Tempo's workouts.
// All-day events and Tempo's own sessions (colorId 11 / "Tempo …") are excluded —
// workouts come from the DB, and all-day items don't sit on a timed timeline.
// This is display-only, so we keep "free"/transparent events too (they're still
// visible in the user's Google Calendar, so they belong on the timeline).

export interface GcalDisplayEvent { id: string; title: string; start: Date; end: Date }

export async function fetchUserEvents(start: Date, end: Date): Promise<GcalDisplayEvent[]> {
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',   // expand recurring events into real instances
    orderBy: 'startTime',   // requires singleEvents
    maxResults: '250',
  })

  const resp = await gcalFetch(`${eventsEndpoint()}?${params.toString()}`, { method: 'GET' })
  if (!resp.ok) throw new Error(`gcal_fetch_failed_${resp.status}`)

  const data = await resp.json()
  const items = (data.items ?? []) as GoogleEvent[]

  return items
    .filter(e =>
      !!e.start?.dateTime && !!e.end?.dateTime &&
      e.status !== 'cancelled' &&
      e.colorId !== WORKOUT_EVENT_COLOR_ID &&
      !(e.summary ?? '').startsWith('Tempo'))
    .map(e => ({
      id: e.id,
      title: e.summary || 'Busy',
      start: new Date(e.start!.dateTime!),
      end: new Date(e.end!.dateTime!),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

// ── 2) The algorithm: find the best open slot (PURE — no network) ───────────────

export function findBestWorkoutSlot(
  busySlots: BusySlot[],
  constraints: SchedulingConstraints,
  options: FindSlotOptions = {},
): ScheduledSlot | null {
  const now = options.now ?? new Date()
  const horizonDays = options.horizonDays ?? 7
  const leadMinutes = options.leadMinutes ?? 60

  const needed = constraints.durationMinutes + bufferForGoal(constraints.workoutGoal)
  const preferred = constraints.timeOfDayPreference ?? defaultWindowForGoal(constraints.workoutGoal)

  // Try the preferred window across the week first; if nothing fits all week,
  // widen to full waking hours rather than failing outright.
  const windowsToTry: [number, number][] = [TIME_WINDOWS[preferred], FULL_DAY]
  const earliest = new Date(now.getTime() + leadMinutes * 60_000)

  for (const [startH, endH] of windowsToTry) {
    for (let d = 0; d < horizonDays; d++) {
      const day = new Date(now)
      day.setDate(now.getDate() + d)

      let winStart = new Date(day); winStart.setHours(startH, 0, 0, 0)
      const winEnd = new Date(day); winEnd.setHours(endH, 0, 0, 0)

      // Never schedule in the past or inside the lead time.
      if (winStart < earliest) winStart = earliest
      if (winStart >= winEnd) continue

      const dayBusy = busySlots
        .filter(b => b.end > winStart && b.start < winEnd)
        .sort((a, b) => a.start.getTime() - b.start.getTime())

      const slotStart = firstGapInWindow(winStart, winEnd, dayBusy, needed)
      if (slotStart) {
        const end = new Date(slotStart.getTime() + constraints.durationMinutes * 60_000)
        return { startTime: slotStart.toISOString(), endTime: end.toISOString() }
      }
    }
  }

  return null
}

// First opening of at least `neededMin` between winStart and winEnd, walking past
// each busy block. Ported from calendarService.findFreeWindows, clamped to the
// time-of-day window. `dayBusy` must be sorted by start.
function firstGapInWindow(winStart: Date, winEnd: Date, dayBusy: BusySlot[], neededMin: number): Date | null {
  let cursor = winStart.getTime()
  const end = winEnd.getTime()

  for (const b of dayBusy) {
    const bStart = b.start.getTime()
    const bEnd = b.end.getTime()
    if (bEnd <= cursor) continue       // already past this block
    if (bStart >= end) break           // block starts after our window

    if (bStart > cursor) {
      const gapEnd = Math.min(bStart, end)
      if ((gapEnd - cursor) / 60_000 >= neededMin) return new Date(cursor)
    }
    if (bEnd > cursor) cursor = bEnd    // jump to the end of this block
    if (cursor >= end) return null      // window consumed
  }

  if (cursor < end && (end - cursor) / 60_000 >= neededMin) return new Date(cursor)
  return null
}

// ── 3) Write the workout back as a tomato-red (Color ID 11) event ───────────────

export async function autoScheduleWorkout(
  title: string,
  startTime: string | Date,
  durationMinutes: number,
): Promise<CalendarEvent> {
  const start = new Date(startTime)
  const end = new Date(start.getTime() + durationMinutes * 60_000)

  const resp = await gcalFetch(eventsEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: title,
      description: 'Scheduled automatically by Tempo around your calendar.',
      colorId: WORKOUT_EVENT_COLOR_ID, // '11' = Tomato — stands out from other events
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
    }),
  })

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`gcal_insert_failed_${resp.status}: ${detail.slice(0, 200)}`)
  }
  return (await resp.json()) as CalendarEvent
}

// Delete an event by id. Used to roll back a just-created event when the matching
// Tempo workout fails to save, so we never leave an orphan on the calendar.
// 404/410 (already gone) are treated as success.
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const resp = await gcalFetch(`${eventsEndpoint()}/${encodeURIComponent(eventId)}`, { method: 'DELETE' })
  if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
    throw new Error(`gcal_delete_failed_${resp.status}`)
  }
}

// ── Authed fetch with one transparent re-mint on 401 ────────────────────────────

async function gcalFetch(url: string, init: RequestInit): Promise<Response> {
  let token = await getGoogleAccessToken()
  if (!token) throw new Error('not_connected')

  let resp = await fetch(url, withAuth(init, token))
  if (resp.status === 401) {
    // Cached token was rejected (revoked / clock skew) — re-mint once and retry.
    invalidateGoogleAccessToken()
    token = await getGoogleAccessToken()
    if (!token) throw new Error('not_connected')
    resp = await fetch(url, withAuth(init, token))
  }
  return resp
}

function withAuth(init: RequestInit, token: string): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } }
}
