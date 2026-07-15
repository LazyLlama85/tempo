// Tempo — retention & activation instrumentation (audit "Critical" tier).
//
// The app already had a rich funnel (onboarding_complete, session_start/end,
// first_workout_*), but two blind spots made retention impossible to reason about:
//   1. No single "activated" signal — the moment the core loop is proven to work
//      for a user: they came BACK and completed a second session. First-run taps
//      are cheap; a returning completion is the real habit signal.
//   2. No "connected a calendar" signal — Tempo's entire thesis is that scheduling
//      training around a real calendar drives consistency, yet we couldn't measure
//      whether calendar-adopters retain better than everyone else.
//
// Both fire AT MOST ONCE per user (per provider, for the calendar), guarded by
// durable, per-user, force-close-proof localStorage flags — the exact idiom the
// tutorial and guest-save prompts already use (see accountLinking.ts). This module
// is analytics-only: it changes no app behavior, and with no PostHog key configured
// every track() is a no-op, so the app is byte-for-byte identical without it.

import { track } from '@/lib/analytics'
import { countCompletedWorkouts } from '@/lib/accountLinking'

export type CalendarProvider = 'google' | 'device'

// Completing this many sessions = "activated". Two, not one: a single first-run
// workout proves nothing about the habit; a SECOND completion means the user
// returned and the plan → train → log loop is actually working for them.
export const ACTIVATION_SESSIONS = 2

const activatedKey = (userId: string) => `tempo.activated.${userId}`
const calendarConnectedKey = (userId: string, provider: CalendarProvider) =>
  `tempo.calendarConnected.${userId}.${provider}`

function flagRead(key: string): boolean {
  try {
    return !!(globalThis as { localStorage?: Storage }).localStorage?.getItem(key)
  } catch {
    // Broken storage → treat as already-fired so we never spam duplicate events.
    return true
  }
}

function flagSet(key: string): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(key, '1')
  } catch {
    /* best-effort; analytics-only gating */
  }
}

// Fire `activation_reached` exactly once, the first time the user crosses the
// completed-session threshold. Call after a session is banked (workout-complete).
// Best-effort throughout: once fired, the durable flag short-circuits before any DB
// read, so the count query only runs until the user activates and then never again.
// `completed` lets a caller that already knows the fresh count skip the extra query.
export async function maybeTrackActivation(userId: string, completed?: number): Promise<void> {
  if (!userId) return
  const key = activatedKey(userId)
  if (flagRead(key)) return
  try {
    const n = completed ?? (await countCompletedWorkouts(userId))
    if (n < ACTIVATION_SESSIONS) return
    flagSet(key)
    track('activation_reached', { sessions: n })
  } catch {
    /* best-effort — never block the celebration screen on an analytics count */
  }
}

// Fire `calendar_connected` the first time a user connects a given calendar
// provider. De-duped per user+provider so a reconnect (e.g. after a Google token
// expiry) isn't miscounted as fresh adoption, and so it can be called from every
// connect site — calendar-setup (Google + device) and Home's device flow — without
// ever double-firing.
export function trackCalendarConnected(userId: string, provider: CalendarProvider): void {
  if (!userId) return
  const key = calendarConnectedKey(userId, provider)
  if (flagRead(key)) return
  flagSet(key)
  track('calendar_connected', { provider })
}
