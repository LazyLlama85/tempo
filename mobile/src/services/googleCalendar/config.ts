// Tempo — Google Calendar (REST API) integration: shared, non-secret config.
//
// Architecture (Reuse Supabase + Edge Function): we reuse the user's existing
// Supabase Google sign-in for auth. Supabase hands us a Google access token
// (session.provider_token) plus a refresh token; a Supabase Edge Function
// refreshes the access token server-side, so the Google *client secret* never
// ships in the app. Everything in this file is safe to bundle — no secrets.

// Scope requested at sign-in AND configured on the Supabase Google provider.
// calendar.events = create/read/update events only (not full calendar mgmt).
//
// B1.5 (multi-calendar): reading BEYOND the primary calendar needs
// 'calendar.calendarlist.readonly'. ENABLED 2026-07-18 — the founder added this
// scope in Google Cloud Console, so fetchCalendarList() (and the calendar picker)
// now work. Two consequences to know: (1) every ALREADY-connected Google user must
// reconnect once — a refresh-token exchange can't retroactively broaden its own
// granted scopes, so existing tokens keep working for primary-calendar events but
// can't list calendars until reconnect; (2) if Google hasn't finished verifying the
// added scope, users may see an "unverified app" consent screen — that's a Google
// dashboard/verification matter, not an app bug. To roll back, re-comment the line.
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const

// Google Calendar REST v3.
export const GCAL_API_BASE = 'https://www.googleapis.com/calendar/v3'

// The user's default calendar. Multi-calendar (B1.5) reads OTHER calendars too,
// selected by id — but 'primary' is always the fallback/default so every existing
// zero-arg caller behaves byte-for-byte the same as before this change.
export const GCAL_PRIMARY = 'primary'
export const eventsEndpoint = (calendarId: string = GCAL_PRIMARY) =>
  `${GCAL_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`

// CalendarList — enumerates the calendars on the user's account (name, color,
// whether it's primary). Needs calendar.calendarlist.readonly (see the scope
// comment above) — calendar.events alone cannot list calendars.
export const calendarListEndpoint = () => `${GCAL_API_BASE}/users/me/calendarList`

// Google's event-color palette id for workouts. 11 = "Tomato" (red), so Tempo
// sessions stand out from the user's other events (set as event.colorId).
export const WORKOUT_EVENT_COLOR_ID = '11'

// Supabase Edge Function (built in Phase 2) that (a) stores a user's Google
// refresh token and (b) exchanges it for a fresh access token on demand using
// the server-side client secret.
export const TOKEN_EDGE_FUNCTION = 'google-calendar-token'
