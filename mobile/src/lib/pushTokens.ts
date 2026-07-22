// Push token registration (client side of server-driven push).
//
// Local scheduling (see notifications.ts) still handles the immediate "your
// workout starts in 30 min" reminder, but every *retention* push — missed
// workout, streak-at-risk, free-time gap, reactivation — is now sent from the
// backend (see supabase/functions/retention-push). For that the server needs a
// device's Expo push token, which is what this module registers and keeps fresh.

import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import type { SupabaseClient } from '@supabase/supabase-js'
import { captureApiError } from '@/lib/crashReporting'

// Android requires a notification channel for pushes to display.
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('workouts', {
    name: 'Workout reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  })
}

/**
 * Request notification permission, obtain this device's Expo push token, and
 * store it against the user in `device_tokens`. Idempotent — safe to call on
 * every app launch; an existing token row is just refreshed (upsert on token).
 *
 * Best-effort: returns null and never throws if permission is denied, the build
 * isn't a real device, or the network call fails. Retention pushes simply won't
 * reach a device we couldn't register.
 */
export async function registerPushToken(
  client: SupabaseClient,
  userId: string
): Promise<string | null> {
  try {
    // Push tokens only exist on physical devices, not simulators.
    if (!Device.isDevice) return null

    // Never prompt from here — this runs on sign-in, before the user has seen any
    // value, and an unprimed OS prompt is where notification opt-in goes to die.
    // Onboarding (plan-preview) owns the ask; we only register once it's granted.
    const existing = await Notifications.getPermissionsAsync()
    if (existing.status !== 'granted') return null

    await ensureAndroidChannel()

    // projectId is required for Expo push tokens in standalone/dev-client builds.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    )

    const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web'

    // Upsert on the unique token: re-registering the same device just bumps
    // last_seen_at and re-enables a token we'd previously marked dead.
    const { error } = await client
      .from('device_tokens')
      .upsert(
        {
          user_id: userId,
          token,
          platform,
          enabled: true,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'token' }
      )
    if (error) throw error

    return token
  } catch (e) {
    captureApiError('registerPushToken', e)
    return null
  }
}

// This device's Expo push token, or null (simulator / no permission / error).
async function currentToken(): Promise<string | null> {
  if (!Device.isDevice) return null
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  try {
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    return data
  } catch {
    return null
  }
}

/**
 * Whether server-driven push is enabled for this device. Defaults to true (push is
 * opt-out per device) when there's no token row yet. Never throws.
 */
export async function getPushEnabled(client: SupabaseClient): Promise<boolean> {
  try {
    const token = await currentToken()
    if (!token) return true
    const { data } = await client
      .from('device_tokens')
      .select('enabled')
      .eq('token', token)
      .maybeSingle()
    return data ? !!data.enabled : true
  } catch {
    return true
  }
}

export type SetPushEnabledResult = 'ok' | 'permission_denied' | 'error'

/**
 * Toggle server-driven push for this device. Turning it on re-registers the token;
 * turning it off flips `device_tokens.enabled` so the retention engine skips it.
 *
 * Returns 'permission_denied' specifically for the case an in-app switch can
 * never actually fix: the OS permission was already denied (a re-request just
 * resolves 'denied' again with no dialog shown, iOS's own anti-nag rule), so
 * the caller can route the user to system Settings instead of leaving the
 * switch in a confusing "on but nothing happens" state.
 */
export async function setPushEnabled(
  client: SupabaseClient,
  userId: string,
  enabled: boolean,
): Promise<SetPushEnabledResult> {
  try {
    if (enabled) {
      // User flipped the switch ON — this IS the right moment for the OS prompt
      // if permission was never granted (registerPushToken itself never asks).
      const perms = await Notifications.getPermissionsAsync()
      if (perms.status !== 'granted') {
        const req = await Notifications.requestPermissionsAsync()
        if (req.status !== 'granted') return 'permission_denied'
      }
      await registerPushToken(client, userId)
    } else {
      const token = await currentToken()
      if (token) {
        const { error } = await client.from('device_tokens').update({ enabled: false }).eq('token', token)
        if (error) return 'error'
      }
    }
    return 'ok'
  } catch (e) {
    captureApiError('setPushEnabled', e)
    return 'error'
  }
}

/** Remove this device's token on sign-out so a signed-out user stops receiving pushes. */
export async function unregisterPushToken(client: SupabaseClient): Promise<void> {
  try {
    if (!Device.isDevice) return
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    )
    await client.from('device_tokens').delete().eq('token', token)
  } catch (e) {
    captureApiError('unregisterPushToken', e)
  }
}
