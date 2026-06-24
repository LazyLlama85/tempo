// Crash reporting — unhandled exceptions, native crashes, and API failures (Sentry).
//
// Kept deliberately separate from analytics (see `analytics.ts`). This module
// owns "when/why the app breaks".
//
// Design notes:
// - Reads its DSN from EXPO_PUBLIC_SENTRY_DSN. When absent every call is a safe
//   no-op, so the app runs identically with or without crash reporting wired up.
// - `Sentry.init` installs handlers for unhandled JS exceptions and (in a
//   release/dev build with the native module) native crashes automatically.
// - User context (id, platform, app version) is attached so crashes can be tied
//   back to a specific user and build.

import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Sentry from '@sentry/react-native'

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN
const APP_VERSION = Constants.expoConfig?.version ?? 'unknown'

let initialized = false

/**
 * Initialise crash reporting once, at app startup (before the rest of the app
 * mounts). Safe to call with no DSN configured — it leaves Sentry disabled.
 */
export function initCrashReporting(): void {
  if (initialized || !SENTRY_DSN) return
  Sentry.init({
    dsn: SENTRY_DSN,
    // Tie every event to the build it came from.
    release: APP_VERSION,
    // Crash reporting only — keep performance tracing off so there's no startup
    // or runtime overhead. Turn this up later if/when we want traces.
    tracesSampleRate: 0,
    // Don't spam the dashboard from local development.
    enabled: !__DEV__,
  })
  Sentry.setTag('platform', Platform.OS)
  Sentry.setTag('app_version', APP_VERSION)
  initialized = true
}

/**
 * Wrap the root component so native crashes and render errors are captured.
 * Returns the component untouched when crash reporting isn't configured.
 */
export const wrapWithCrashReporting: typeof Sentry.wrap = (component) =>
  SENTRY_DSN ? Sentry.wrap(component) : component

/** Attach the signed-in user to all subsequent crash reports. */
export function setCrashUser(userId: string | null): void {
  if (!initialized) return
  Sentry.setUser(userId ? { id: userId } : null)
}

/** Manually report an unexpected error with optional context. */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!initialized) return
  Sentry.captureException(error, context ? { extra: context } : undefined)
}

/**
 * Report a network / API failure. Use for Supabase/edge-function/REST errors
 * that shouldn't crash the app but that we still want visibility into.
 */
export function captureApiError(
  source: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!initialized) return
  Sentry.withScope((scope) => {
    scope.setTag('error_type', 'api')
    scope.setTag('api_source', source)
    if (context) scope.setContext('api', context)
    Sentry.captureException(error)
  })
}
