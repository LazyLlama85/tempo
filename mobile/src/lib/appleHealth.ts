// Tempo — Apple Health (HealthKit) export (PRODUCT_AUDIT.html §26 L28).
//
// One-way WRITE only: a completed Tempo workout becomes a HealthKit workout
// sample so it shows up in the Health app. Never reads anything back —
// steps/HR/sleep import is a separate, deliberately deferred milestone (B5.2
// in EXECUTION.md) and this module doesn't touch it.
//
// Opt-in, default OFF (Settings → "Sync to Apple Health"). Best-effort and
// silent on any failure — matches every other on-device integration in this
// codebase (calendar, notifications): a health-sync failure must never
// interrupt or error the workout-complete flow it's attached to.
//
// iOS only. The native module (@kingstinct/react-native-healthkit, a Nitro
// module) isn't in the JS bundle's native binary until a build that includes
// it — every call here is guarded so it's a no-op (never a crash) on
// Android, web, Expo Go, or any build predating that rebuild.

import { Platform } from 'react-native'
import type { SupabaseClient } from '@supabase/supabase-js'

const STORAGE_KEY = 'tempo.appleHealthSync'

/** Whether the user has opted in, from the last time it was set. Sync, device-local. */
export function getAppleHealthSyncEnabled(): boolean {
  try {
    const v = (globalThis as { localStorage?: Storage }).localStorage?.getItem(STORAGE_KEY)
    return v === '1'
  } catch {
    return false
  }
}

function setStoredEnabled(on: boolean): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch { /* best-effort */ }
}

// Lazily imported — a static import would throw at module-evaluation time on
// every build that doesn't have the native module linked yet (i.e. every
// build before the next native rebuild), which per theme/index.tsx's fix
// earlier this session is exactly the class of bug that produces a blank
// screen on launch. A dynamic import only runs when actually invoked, and
// only on iOS.
async function loadNative() {
  if (Platform.OS !== 'ios') return null
  try {
    return await import('@kingstinct/react-native-healthkit')
  } catch {
    return null // native module not present in this binary yet
  }
}

/**
 * Turn Apple Health sync on/off from Settings. Turning on requests HealthKit
 * write authorization. Per Apple's privacy model for WRITE permissions, the
 * OS deliberately never tells an app whether the user granted or denied —
 * only that the request completed — so a denied user's later
 * `exportWorkoutToAppleHealth` calls just silently no-op, identical to every
 * other permission-gated integration in this app (calendar, notifications).
 * Returns false if the toggle couldn't be turned on (no native module, no
 * HealthKit on this device) — the caller reverts the switch in that case.
 */
export async function setAppleHealthSyncEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    setStoredEnabled(false)
    return true
  }
  const hk = await loadNative()
  if (!hk) return false
  try {
    const available = await hk.isHealthDataAvailableAsync()
    if (!available) return false
    await hk.requestAuthorization({ toShare: ['HKWorkoutTypeIdentifier'] })
    setStoredEnabled(true)
    return true
  } catch {
    return false
  }
}

// Rough calorie estimate from training volume — the audit spec's own words
// ("calories estimated from volume + bodyweight"). ~0.1 kcal per lb of
// volume lifted is a widely-cited resistance-training heuristic; a real
// MET/heart-rate-based estimate needs data this app doesn't collect. Floored
// by a per-minute minimum so a light or short session never reports 0 kcal.
function estimateCalories(volumeLbs: number, durationMin: number): number {
  const fromVolume = volumeLbs * 0.1
  const floor = durationMin * 3
  return Math.max(Math.round(fromVolume), Math.round(floor), 1)
}

async function fetchSessionVolumeLbs(client: SupabaseClient, logId: string): Promise<number> {
  try {
    const { data } = await client
      .from('set_logs')
      .select('weight_lbs, reps_completed')
      .eq('workout_log_id', logId)
      .not('weight_lbs', 'is', null)
      .not('is_warmup', 'is', true)
    let total = 0
    for (const s of (data ?? []) as { weight_lbs: number | null; reps_completed: number }[]) {
      total += (s.weight_lbs ?? 0) * (s.reps_completed ?? 0)
    }
    return total
  } catch {
    return 0
  }
}

/**
 * Write one completed workout to Apple Health. Best-effort and completely
 * silent — never throws, never surfaces an error to the caller. Called once
 * from workout-complete.tsx alongside its other completion side-effects.
 * No-ops immediately (no query, no native call) unless the user has opted in.
 */
export async function exportWorkoutToAppleHealth(
  client: SupabaseClient,
  params: { logId: string; durationMin: number },
): Promise<void> {
  if (!getAppleHealthSyncEnabled()) return
  const hk = await loadNative()
  if (!hk) return
  try {
    const durationMin = Math.max(1, params.durationMin)
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - durationMin * 60_000)
    const volumeLbs = await fetchSessionVolumeLbs(client, params.logId)
    await hk.saveWorkoutSample(
      hk.WorkoutActivityType.traditionalStrengthTraining,
      [],
      startDate,
      endDate,
      { energyBurned: estimateCalories(volumeLbs, durationMin) },
    )
  } catch {
    /* best-effort — a failed export must never interrupt workout completion */
  }
}
