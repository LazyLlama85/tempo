// Tempo — haptics vocabulary.
//
// One tiny, consistent set of tactile moments instead of ad-hoc Vibration calls:
//   tapLight    — logging a set, checking a box, picking an option
//   tapMedium   — an exercise fully done, removing something
//   success     — workout complete, personal record, level up
//   warning     — destructive confirm shown / timer about to end
//
// expo-haptics is a native module; a dev client built before it was added won't
// have it, and Expo Go never will. Every call is therefore guarded — worst case
// is silence (or the old Vibration fallback for `success`), never a crash.

import { Vibration } from 'react-native'

type HapticsModule = typeof import('expo-haptics')

let Haptics: HapticsModule | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Haptics = require('expo-haptics') as HapticsModule
} catch {
  Haptics = null
}

function safe(fn: (h: HapticsModule) => Promise<void>, fallback?: () => void): void {
  if (Haptics) {
    fn(Haptics).catch(() => fallback?.())
  } else {
    fallback?.()
  }
}

/** Light tick — completing a set, checking a box. */
export function tapLight(): void {
  safe((h) => h.impactAsync(h.ImpactFeedbackStyle.Light))
}

/** Medium thud — an exercise finished, a set removed. */
export function tapMedium(): void {
  safe((h) => h.impactAsync(h.ImpactFeedbackStyle.Medium))
}

/** Success notification — workout complete, PR, level up. */
export function success(): void {
  safe(
    (h) => h.notificationAsync(h.NotificationFeedbackType.Success),
    () => Vibration.vibrate([0, 180, 100, 180]),
  )
}

/** Warning notification — rest timer done, destructive confirm. */
export function warning(): void {
  safe(
    (h) => h.notificationAsync(h.NotificationFeedbackType.Warning),
    () => Vibration.vibrate([0, 250, 150, 250]),
  )
}
