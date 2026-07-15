// Analytics — product event tracking (PostHog).
//
// Kept deliberately separate from crash reporting (see `crashReporting.ts`).
// This module owns "what users do"; that one owns "when/why the app breaks".
//
// Design notes:
// - Reads its key from EXPO_PUBLIC_POSTHOG_KEY. When that's absent (e.g. local
//   dev without a key, or PR previews) every call becomes a safe no-op, so the
//   app behaves identically with or without analytics configured.
// - Events are typed via `EventProperties` so call sites stay consistent and
//   typos / wrong payloads fail at compile time rather than silently in prod.
// - Init is fire-and-forget and PostHog batches/flushes on a background timer,
//   so there's no measurable cost on app startup or on the JS thread.

import { Platform } from 'react-native'
import Constants from 'expo-constants'
import PostHog from 'posthog-react-native'

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

const APP_VERSION = Constants.expoConfig?.version ?? 'unknown'

let posthog: PostHog | null = null

/**
 * The canonical set of product events and their payloads. Add new events here
 * — the typed `track()` signature is derived from this map, so every call site
 * is checked against it. Use `undefined` for events that carry no properties.
 */
export type EventProperties = {
  app_open: undefined
  user_signup: { method: AuthMethod }
  login: { method: AuthMethod }
  onboarding_complete: {
    goal: string
    experience: string
    days_per_week: number
  }
  // A workout session was started (Quick Workout or a planned session).
  session_start: {
    type: SessionType
    duration_min?: number
    purpose?: string
  }
  // A workout session finished and was logged.
  session_end: {
    type: SessionType
    duration_min?: number
  }
  // Core feature usage.
  quick_workout_generated: { minutes: number; purpose: string }
  workout_feedback_submitted: { feel: string }
  share_card_opened: undefined
  // Auto-progression graduated the user to a harder experience level.
  experience_promoted: { from: string; to: string }
  // ── Retention & activation instrumentation (audit "Critical" tier) ──────────
  // Fired once per user when the core loop is proven — they returned and completed
  // their Nth session (see lib/activation.ACTIVATION_SESSIONS). The activation event
  // PostHog builds retention cohorts and the onboarding→activation funnel from.
  activation_reached: { sessions: number }
  // Fired once per user+provider the first time a calendar is connected — the wedge
  // adoption signal, so retention/consistency can be split by calendar-adopters vs not.
  calendar_connected: { provider: 'google' | 'device' }
  // ── First-time experience (tutorial framework) ──────────────────────────────
  tutorial_started: { tutorial: string; experience?: string }
  tutorial_step_completed: { tutorial: string; step: string; experience?: string }
  tutorial_skipped: { tutorial: string; experience?: string }
  tutorial_completed: { tutorial: string; experience?: string }
  tutorial_replayed: { tutorial: string }
  first_workout_started: { experience?: string }
  first_set_logged: { experience?: string }
  first_workout_completed: { experience?: string; duration_min?: number }
  // ── Guest → permanent account linking (§1.1) ────────────────────────────────
  // `context` distinguishes the Profile card from the post-workout modal.
  guest_save_prompt_shown: { context: 'profile' | 'post_workout' }
  guest_save_started: { method: 'google' | 'apple'; context: 'profile' | 'post_workout' }
  guest_upgraded: { method: 'google' | 'apple'; context: 'profile' | 'post_workout' }
  // ── Tempo Pro / monetization (§10) ──────────────────────────────────────────
  // Derived client-side from RevenueCat entitlement transitions; RevenueCat
  // webhooks remain the source of truth for revenue reporting.
  paywall_shown: { context: string }
  paywall_dismissed: { context: string }
  // The custom paywall's purchase funnel (RevenueCat webhooks remain the revenue truth).
  purchase_started: { plan: string; context: string }
  purchase_completed: { plan: string; context: string }
  purchase_failed: { plan: string; reason: 'cancelled' | 'error' }
  restore_completed: { restored: boolean }
  trial_started: undefined
  trial_converted: undefined
  subscription_cancelled: undefined
}

export type AuthMethod = 'google' | 'apple' | 'guest'
export type SessionType = 'quick' | 'planned'

type EventName = keyof EventProperties

// Properties attached to every event automatically.
function superProperties() {
  return {
    platform: Platform.OS,
    app_version: APP_VERSION,
  }
}

/**
 * Initialise analytics once, at app startup. Safe to call when no key is
 * configured — it simply leaves analytics disabled.
 */
export function initAnalytics(): void {
  if (posthog || !POSTHOG_KEY) return
  posthog = new PostHog(POSTHOG_KEY, {
    host: POSTHOG_HOST,
    // Don't capture the very first app session synchronously; let the batch
    // queue flush on its own schedule so startup stays cheap.
    flushAt: 20,
    flushInterval: 30_000,
  })
  posthog.register(superProperties())
}

/**
 * Track a product event. No-ops if analytics isn't configured.
 *
 *   track('app_open')
 *   track('login', { method: 'apple' })
 */
export function track<E extends EventName>(
  event: E,
  ...args: EventProperties[E] extends undefined ? [] : [EventProperties[E]]
): void {
  if (!posthog) return
  posthog.capture(event, args[0] as Record<string, any> | undefined)
}

/**
 * Associate subsequent events with a signed-in user. Call on sign-in and on
 * app start when a session already exists.
 */
export function identifyUser(userId: string): void {
  if (!posthog) return
  posthog.identify(userId, superProperties())
}

/** Clear identity on sign-out so the next user starts a fresh anonymous id. */
export function resetUser(): void {
  if (!posthog) return
  posthog.reset()
}
