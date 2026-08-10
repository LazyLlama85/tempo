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
import { eventsEndpoint, calendarListEndpoint, GCAL_PRIMARY, WORKOUT_EVENT_COLOR_ID } from './config'
import { captureApiError, captureDiagnostic } from '@/lib/crashReporting'
import { CALENDAR_EVENT_PREFIX, LEGACY_CALENDAR_EVENT_PREFIXES } from '@/constants/brand'

// Matches CALENDAR_EVENT_PREFIX and every LEGACY_CALENDAR_EVENT_PREFIXES entry,
// so events created under a prior name are still recognized as the app's own.
const APP_EVENT_TITLE_PATTERN = new RegExp(
  `^(${[CALENDAR_EVENT_PREFIX, ...LEGACY_CALENDAR_EVENT_PREFIXES].join('|')})\\s*[·•:\\-]`,
  'i',
)

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

// ── Diagnostics: never let a Calendar READ fail silently ─────────────────────────
// A valid access token that still can't read the calendar means a Google-PROJECT
// gap, not a token problem — almost always either the Calendar API isn't enabled,
// or the token was granted WITHOUT the calendar.events scope (a common break right
// after flipping the OAuth app to "In production" without registering the scope).
// getCalendarEventsForRange swallows read failures to [] on purpose (so the feed
// never blanks), which historically made this impossible to diagnose. We now record
// + report the real Google reason so the cause is visible in Sentry and to any UI.
let lastReadError: { status: number; reason: string } | null = null
export function getLastCalendarReadError(): { status: number; reason: string } | null {
  return lastReadError
}

// Read the Google error body ONCE, map it to a concrete reason + fix hint, record +
// report it, and return an Error for the caller to throw. Google shape:
// { error: { code, status, message, errors: [{ reason }] } }.
async function describeReadError(resp: Response, where: string): Promise<Error> {
  let reason = `http_${resp.status}`
  try {
    const body = await resp.json()
    reason = body?.error?.errors?.[0]?.reason || body?.error?.status || body?.error?.message || reason
  } catch { /* body wasn't JSON */ }
  lastReadError = { status: resp.status, reason }
  const hint =
    /accessNotConfigured|SERVICE_DISABLED/i.test(reason) ? 'Enable "Google Calendar API" in the Cloud project (APIs & Services → Library).'
    : /scope|insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason) ? 'Register the calendar.events scope (Auth Platform → Data Access), then disconnect + reconnect Google in the app.'
    : /PERMISSION_DENIED|forbidden/i.test(reason) ? 'Calendar API permission denied — check API enablement + granted scope.'
    : undefined
  captureApiError('gcal_read', new Error(`${where}_${resp.status}_${reason}`), { status: resp.status, reason, hint })
  return new Error(`gcal_fetch_failed_${resp.status}_${reason}`)
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

// ── 0) Enumerate the user's calendars (B1.5, multi-calendar — dormant until the
//        calendar.calendarlist.readonly scope is granted; see config.ts) ─────────

export interface GoogleCalendarListEntry {
  id: string
  summary: string
  primary?: boolean
  backgroundColor?: string
}

// Honest, not silent: while the scope doesn't exist yet, every real account will
// get a 403 here. Reuses the same describeReadError diagnostics as every other
// read path (so "insufficient scope" reports the same way "no Calendar API
// enabled" already does) — the caller renders whatever it gets, including empty.
export async function fetchCalendarList(): Promise<GoogleCalendarListEntry[]> {
  const resp = await gcalFetch(`${calendarListEndpoint()}?minAccessRole=freeBusyReader`, { method: 'GET' })
  if (!resp.ok) throw await describeReadError(resp, 'fetchCalendarList')
  const data = await resp.json()
  return ((data.items ?? []) as GoogleCalendarListEntry[])
    .map(c => ({ id: c.id, summary: c.summary, primary: c.primary, backgroundColor: c.backgroundColor }))
}

// ── 1) Read the week's agenda from the selected calendar(s) ─────────────────────
// Multi-calendar (B1.5): `calendarIds` defaults to just `['primary']` so every
// existing caller (zero-arg or one-arg) is byte-for-byte unchanged. Only a caller
// that explicitly passes a real `selected_google_calendar_ids` profile value reads
// more than one. Each calendar is fetched independently and best-effort — one
// calendar erroring (e.g. it was removed) doesn't blank the whole busy-time read.

export async function fetchUserBusySlots(daysAhead = 7, calendarIds: string[] = [GCAL_PRIMARY]): Promise<BusySlot[]> {
  const now = new Date()
  const timeMax = new Date(now.getTime() + daysAhead * 86_400_000)

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',   // expand recurring events into real instances
    orderBy: 'startTime',   // requires singleEvents
    maxResults: '250',
  })

  const ids = calendarIds.length ? calendarIds : [GCAL_PRIMARY]
  const perCalendar = await Promise.all(ids.map(async (id, i) => {
    const resp = await gcalFetch(`${eventsEndpoint(id)}?${params.toString()}`, { method: 'GET' })
    if (!resp.ok) {
      // The primary calendar failing is a real error (matches old behavior);
      // an ADDITIONAL selected calendar failing is best-effort — skip it rather
      // than lose the whole read over one bad calendar id.
      if (i === 0) throw await describeReadError(resp, 'fetchUserBusySlots')
      return [] as GoogleEvent[]
    }
    const data = await resp.json()
    return (data.items ?? []) as GoogleEvent[]
  }))

  return perCalendar.flat()
    // Skip ones the user marked "free" (transparency:'transparent' — Google's own
    // "doesn't block my calendar" flag, e.g. how a lot of people tag birthdays),
    // skip cancelled, and skip Tempo's own workouts (colorId 11) — those are
    // tracked as scheduled_workouts, so counting them here would double-book.
    .filter(e => e.transparency !== 'transparent' && e.status !== 'cancelled' && e.colorId !== WORKOUT_EVENT_COLOR_ID)
    // Timed events (dateTime) AND all-day events (date) both count as busy — an
    // all-day "Vacation"/"Flight"/"Out of Office" used to be silently invisible
    // to scheduling (only .dateTime events were read), so Tempo would happily
    // auto-schedule a workout into a day the user is fully unavailable.
    .filter(e => (!!e.start?.dateTime && !!e.end?.dateTime) || (!!e.start?.date && !!e.end?.date))
    .map(e => e.start?.dateTime
      // Google's all-day `date` fields have no time zone — treat them as local
      // calendar days (midnight to midnight). `end.date` is already the day
      // AFTER the last all-day day (Google's own exclusive-end convention), so
      // this span is already the correct full-day (or multi-day) busy window
      // with no off-by-one adjustment needed.
      ? { start: new Date(e.start!.dateTime!), end: new Date(e.end!.dateTime!) }
      : { start: new Date(`${e.start!.date}T00:00:00`), end: new Date(`${e.end!.date}T00:00:00`) })
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

export async function fetchUserEvents(start: Date, end: Date, calendarIds: string[] = [GCAL_PRIMARY]): Promise<GcalDisplayEvent[]> {
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',   // expand recurring events into real instances
    orderBy: 'startTime',   // requires singleEvents
    maxResults: '250',
  })

  const ids = calendarIds.length ? calendarIds : [GCAL_PRIMARY]
  const perCalendar = await Promise.all(ids.map(async (id, i) => {
    const resp = await gcalFetch(`${eventsEndpoint(id)}?${params.toString()}`, { method: 'GET' })
    if (!resp.ok) {
      if (i === 0) throw await describeReadError(resp, 'fetchUserEvents')
      return [] as GoogleEvent[] // an additional selected calendar failing is best-effort
    }
    const data = await resp.json()
    return (data.items ?? []) as GoogleEvent[]
  }))
  const items = perCalendar.flat()

  const kept = items
    .filter(e =>
      !!e.start?.dateTime && !!e.end?.dateTime &&
      e.status !== 'cancelled' &&
      e.colorId !== WORKOUT_EVENT_COLOR_ID &&
      !APP_EVENT_TITLE_PATTERN.test((e.summary ?? '').trim()))
    .map(e => ({
      id: e.id,
      title: e.summary || 'Busy',
      start: new Date(e.start!.dateTime!),
      end: new Date(e.end!.dateTime!),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  // Diagnostic for the "connected + 200 from Google, but the feed is empty" case:
  // Google returned events yet every one was filtered out of the timeline. The usual
  // cause is that the user's events are ALL-DAY (we only render timed events) — or
  // they're all Tempo's own. Nothing failed here — Google returned 200 and the filter
  // did exactly what it's supposed to — so this reports at Sentry's info level
  // (captureDiagnostic), not as an Error (captureApiError's always-Error level was
  // drowning genuine bugs in expected, benign "all-day-only day" noise).
  if (items.length > 0 && kept.length === 0) {
    const allDay = items.filter(e => !!e.start?.date && !e.start?.dateTime).length
    captureDiagnostic('gcal_events_hidden', `all_filtered_raw_${items.length}_allDay_${allDay}`, {
      raw: items.length, allDay, timed: items.length - allDay,
      hint: 'Google returned events but none survived the timed-event / primary-calendar filter — likely all-day events or a secondary calendar.',
    })
  }
  return kept
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
      description: `Scheduled automatically by ${CALENDAR_EVENT_PREFIX} around your calendar.`,
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

// Delete EVERY Tempo event from the user's Google Calendar within [start, end],
// paging through all results. A Tempo event is identified by its tomato colorId
// (every Tempo event uses it) OR a "Tempo · …"/"Tempo: …" title — so this also
// clears orphans the app no longer has a DB pointer to. Returns the count removed.
export async function deleteTempoGoogleEvents(start: Date, end: Date): Promise<number> {
  let removed = 0
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const resp = await gcalFetch(`${eventsEndpoint()}?${params.toString()}`, { method: 'GET' })
    if (!resp.ok) throw new Error(`gcal_fetch_failed_${resp.status}`)
    const data = await resp.json()

    for (const e of (data.items ?? []) as GoogleEvent[]) {
      if (!e.id || e.status === 'cancelled') continue
      const isOwnEvent = e.colorId === WORKOUT_EVENT_COLOR_ID || APP_EVENT_TITLE_PATTERN.test((e.summary ?? '').trim())
      if (!isOwnEvent) continue
      try { await deleteCalendarEvent(e.id); removed++ } catch { /* best-effort */ }
    }
    pageToken = data.nextPageToken
  } while (pageToken)
  return removed
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
