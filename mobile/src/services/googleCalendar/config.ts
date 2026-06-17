// Tempo — Google Calendar (REST API) integration: shared, non-secret config.
//
// Architecture (Reuse Supabase + Edge Function): we reuse the user's existing
// Supabase Google sign-in for auth. Supabase hands us a Google access token
// (session.provider_token) plus a refresh token; a Supabase Edge Function
// refreshes the access token server-side, so the Google *client secret* never
// ships in the app. Everything in this file is safe to bundle — no secrets.

// Scope requested at sign-in AND configured on the Supabase Google provider.
// calendar.events = create/read/update events only (not full calendar mgmt).
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
] as const

// Google Calendar REST v3.
export const GCAL_API_BASE = 'https://www.googleapis.com/calendar/v3'

// We always operate on the user's default ('primary') calendar.
export const GCAL_PRIMARY = 'primary'
export const eventsEndpoint = () =>
  `${GCAL_API_BASE}/calendars/${encodeURIComponent(GCAL_PRIMARY)}/events`

// Google's event-color palette id for workouts. 11 = "Tomato" (red), so Tempo
// sessions stand out from the user's other events (set as event.colorId).
export const WORKOUT_EVENT_COLOR_ID = '11'

// Supabase Edge Function (built in Phase 2) that (a) stores a user's Google
// refresh token and (b) exchanges it for a fresh access token on demand using
// the server-side client secret.
export const TOKEN_EDGE_FUNCTION = 'google-calendar-token'
