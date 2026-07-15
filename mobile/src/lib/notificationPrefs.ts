// Tempo — notification preferences (audit §6.1).
//
// Splits the old single push toggle into per-rule control so muting one nag doesn't
// silence the whole channel. Two storage homes, each matching the nature of the
// signal:
//   • The four SERVER retention rules live account-level in
//     `user_profiles.notification_prefs` (jsonb) — the retention-push Edge Function
//     reads them at send time and skips any that are off.
//   • The PRE-WORKOUT reminder is a LOCAL notification, so it's a device-local
//     preference (like units/theme), read synchronously and used to gate
//     `scheduleWorkoutReminders`.
//
// The master push switch (device_tokens.enabled, in pushTokens.ts) is unchanged and
// still gates whether ANY server push reaches this device; these are the finer
// controls beneath it. The `reactivation` win-back stays always-on (low frequency,
// highest-value) and so isn't user-exposed here.

import type { SupabaseClient } from '@supabase/supabase-js'

// Rules the user can toggle from Profile. `pre_workout` is device-local; the rest
// are account-level and map 1:1 to the Edge Function's NotificationType names.
export type ServerRule =
  | 'missed_workout' | 'streak_at_risk' | 'weekly_report' | 'free_time_gap'
  | 'partner_reminder' | 'friend_competition'
export type NotificationRule = 'pre_workout' | ServerRule

export interface NotificationPrefs {
  pre_workout: boolean
  missed_workout: boolean
  streak_at_risk: boolean
  weekly_report: boolean
  free_time_gap: boolean
  partner_reminder: boolean
  friend_competition: boolean
}

// Defaults: everything ON — this preserves the exact behavior that shipped before
// per-rule control existed (nothing a user currently receives silently stops). The
// audit suggested free_time_gap default OFF as the most speculative of the set; to
// switch to that, set it to false here AND flip the free_time_gap default in the
// Edge Function's ruleEnabled(). MUST stay in sync with the Edge Function.
export const DEFAULT_PREFS: NotificationPrefs = {
  pre_workout: true,
  missed_workout: true,
  streak_at_risk: true,
  weekly_report: true,
  free_time_gap: true,
  partner_reminder: true,
  friend_competition: true,
}

export const SERVER_RULES: ServerRule[] = [
  'missed_workout', 'streak_at_risk', 'weekly_report', 'free_time_gap',
  'partner_reminder', 'friend_competition',
]

// ── Pre-workout reminder: device-local (SQLite-backed localStorage, like units) ──
const PRE_WORKOUT_KEY = 'tempo.notif.pre_workout'

/** Whether the on-device pre-workout reminder is enabled. Defaults on. Sync. */
export function getPreWorkoutEnabled(): boolean {
  try {
    const v = (globalThis as { localStorage?: Storage }).localStorage?.getItem(PRE_WORKOUT_KEY)
    return v == null ? DEFAULT_PREFS.pre_workout : v === '1'
  } catch {
    return DEFAULT_PREFS.pre_workout
  }
}

export function setPreWorkoutEnabled(on: boolean): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(PRE_WORKOUT_KEY, on ? '1' : '0')
  } catch { /* best-effort; UX-only */ }
}

// ── Account-level server rules: user_profiles.notification_prefs (jsonb) ─────────

// Overlay a stored jsonb blob onto the defaults, plus the device-local pre_workout.
export function mergePrefs(stored: Record<string, unknown> | null | undefined): NotificationPrefs {
  const out: NotificationPrefs = { ...DEFAULT_PREFS, pre_workout: getPreWorkoutEnabled() }
  if (stored) {
    for (const r of SERVER_RULES) {
      if (typeof stored[r] === 'boolean') out[r] = stored[r] as boolean
    }
  }
  return out
}

/** Load the full effective preference set for the UI. Never throws. */
export async function loadNotificationPrefs(
  client: SupabaseClient,
  userId: string,
): Promise<NotificationPrefs> {
  try {
    const { data } = await client
      .from('user_profiles')
      .select('notification_prefs')
      .eq('user_id', userId)
      .maybeSingle()
    return mergePrefs((data?.notification_prefs ?? null) as Record<string, unknown> | null)
  } catch {
    return mergePrefs(null)
  }
}

/**
 * Flip one account-level rule. Read-modify-writes the jsonb so untouched rules keep
 * their stored value (toggles are one-at-a-time, so no meaningful race). Best-effort.
 */
export async function setServerRuleEnabled(
  client: SupabaseClient,
  userId: string,
  rule: ServerRule,
  enabled: boolean,
): Promise<void> {
  try {
    const { data } = await client
      .from('user_profiles')
      .select('notification_prefs')
      .eq('user_id', userId)
      .maybeSingle()
    const current = (data?.notification_prefs ?? {}) as Record<string, boolean>
    const next = { ...current, [rule]: enabled }
    await client.from('user_profiles').update({ notification_prefs: next }).eq('user_id', userId)
  } catch { /* best-effort; the switch re-syncs from the server on next load */ }
}

// ── Master push switch: persisted at the USER level ─────────────────────────────
// device_tokens.enabled (pushTokens.ts) still gates whether the retention engine
// sends to a *device* — but it can only persist "off" when a push token exists.
// On devices where the token isn't registered (no APNs creds yet, simulator, denied
// permission) the old master toggle would silently revert. Storing the master flag
// in user_profiles.notification_prefs.push_enabled makes the switch *stick* for that
// user regardless of token state; setPushEnabled still flips device_tokens too.

export async function getMasterPushEnabled(client: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data } = await client
      .from('user_profiles')
      .select('notification_prefs')
      .eq('user_id', userId)
      .maybeSingle()
    const prefs = (data?.notification_prefs ?? {}) as Record<string, unknown>
    return prefs.push_enabled === false ? false : true // default on (opt-out)
  } catch {
    return true
  }
}

export async function setMasterPushEnabled(client: SupabaseClient, userId: string, enabled: boolean): Promise<void> {
  try {
    const { data } = await client
      .from('user_profiles')
      .select('notification_prefs')
      .eq('user_id', userId)
      .maybeSingle()
    const current = (data?.notification_prefs ?? {}) as Record<string, unknown>
    await client.from('user_profiles').update({ notification_prefs: { ...current, push_enabled: enabled } }).eq('user_id', userId)
  } catch { /* best-effort; re-syncs on next load */ }
}
