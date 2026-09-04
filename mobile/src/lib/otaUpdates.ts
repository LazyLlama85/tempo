// Arclo — actively fetch and apply OTA updates.
//
// WHY THIS EXISTS (a real, measured delivery failure, not hygiene).
//
// The app never called expo-updates at all, so update delivery was left entirely
// to the library's passive default: check on cold start, download in the
// background, and apply on the NEXT cold start. On iOS an app can stay warm for
// days, so "the next cold start" is not a thing that reliably happens — the user
// backgrounds the app and comes back to the same JS bundle indefinitely.
//
// The cost of that was measured on 2026-09-04. Three days of fixes had been
// published to the correct branch, channel and runtime (all verified against
// EAS: build 36 is channel `production`, runtime 1.0.1; the production channel
// points at the production branch; updates exist for both runtimes). Despite
// that, PostHog showed that of the users who ran the first-run tour in the
// previous 48 hours, EVERY step id belonged to the OLD 14-card tour that had
// been cut two days earlier. Not one user was running the new bundle. The
// tutorial fixes, the scheduling fixes and the push/pull fix were all shipped
// and none of them had reached anybody.
//
// So this module makes delivery active:
//   • check + download at cold start (in the background — never blocks launch)
//   • apply on the next foreground-after-background, which happens far sooner
//     and far more often than a genuine cold start
//
// Two hard safety rules, because a reload throws away in-memory state:
//   • NEVER reload while a workout is in progress. Unsaved sets would go with
//     it. `useSessionActiveStore` is the same flag the tab bar already uses.
//   • NEVER reload more than once per app process, so a bad update can't put
//     the app in a reload loop.
//
// Everything here is best-effort. An update check that throws (offline, Expo
// unreachable, an unusual platform) must never surface to the user or break
// startup, so every path is caught and swallowed.

import { AppState, type AppStateStatus } from 'react-native'
import * as Updates from 'expo-updates'
import { useSessionActiveStore } from '@/stores/sessionActive'
import { track } from '@/lib/analytics'

/**
 * How long the app must have been backgrounded before a foreground counts as a
 * safe moment to swap the bundle. A quick app-switch to check a text message is
 * not a moment to restart under someone; a genuine return to the app is.
 */
const MIN_BACKGROUND_MS = 30_000

let pendingReload = false
let hasReloaded = false
let lastBackgroundedAt = 0
let started = false

/** Is expo-updates actually usable right now? False in dev builds and Expo Go. */
function usable(): boolean {
  // checkForUpdateAsync/fetchUpdateAsync both throw in development mode.
  return Updates.isEnabled && !__DEV__
}

/**
 * Identifies the JS bundle actually running, as opposed to the binary version.
 *
 * `analytics.superProperties()` only ever reported `app_version`, which is the
 * NATIVE version and is identical for every user on a given build whether or not
 * they have taken an OTA. That is precisely why the delivery failure above was
 * invisible for three days: every event said "1.0.1" and looked healthy. These
 * make the running bundle visible on every event.
 */
export function updateProperties(): {
  js_update_id: string
  js_update_created_at: string | null
  js_is_embedded: boolean
} {
  try {
    return {
      // 'embedded' rather than null so the property is always present and
      // groupable in PostHog — a missing property and an embedded launch are
      // different facts and should not look the same.
      js_update_id: Updates.updateId ?? 'embedded',
      js_update_created_at: Updates.createdAt ? Updates.createdAt.toISOString() : null,
      js_is_embedded: Updates.isEmbeddedLaunch,
    }
  } catch {
    return { js_update_id: 'unknown', js_update_created_at: null, js_is_embedded: false }
  }
}

/** Download a newer bundle if one exists. Returns true when one is now staged. */
async function checkAndFetch(): Promise<boolean> {
  if (!usable() || pendingReload) return pendingReload
  try {
    const check = await Updates.checkForUpdateAsync()
    if (!check.isAvailable) return false
    const fetched = await Updates.fetchUpdateAsync()
    if (!fetched.isNew) return false
    pendingReload = true
    track('ota_update_downloaded', {})
    return true
  } catch {
    // Offline, or the update server is unreachable. Try again next foreground.
    return false
  }
}

/** Is it safe to swap the bundle out from under the user right now? */
function safeToReload(): boolean {
  if (!pendingReload || hasReloaded) return false
  // A live workout holds unsaved sets in memory. Never.
  if (useSessionActiveStore.getState().active) return false
  return true
}

async function applyIfSafe(): Promise<void> {
  if (!safeToReload()) return
  hasReloaded = true
  track('ota_update_applied', {})
  try {
    await Updates.reloadAsync()
  } catch {
    // Reload refused; leave the update staged. expo-updates will still apply it
    // on the next genuine cold start, which is the old behaviour, not a new bug.
    hasReloaded = false
  }
}

/**
 * Start watching for updates. Call once, at app startup. Returns a teardown
 * function so the effect that owns it can clean up.
 */
export function startUpdateWatcher(): () => void {
  if (!usable() || started) return () => {}
  started = true

  // Cold-start pass: stage an update for the next foreground. Deliberately not
  // awaited — launch must not wait on the network.
  void checkAndFetch()

  const onChange = (state: AppStateStatus) => {
    if (state === 'background' || state === 'inactive') {
      lastBackgroundedAt = Date.now()
      return
    }
    if (state !== 'active') return

    const away = Date.now() - lastBackgroundedAt
    if (lastBackgroundedAt === 0 || away < MIN_BACKGROUND_MS) return

    void (async () => {
      // Apply what is already staged first — that is the fix the user is
      // waiting on — then look for anything newer for next time.
      await applyIfSafe()
      if (await checkAndFetch()) await applyIfSafe()
    })()
  }

  const sub = AppState.addEventListener('change', onChange)
  return () => {
    sub.remove()
    started = false
  }
}
