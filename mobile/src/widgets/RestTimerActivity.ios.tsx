// Tempo — Rest Timer Live Activity (Lock Screen + Dynamic Island, iOS only).
//
// `.ios.tsx` on purpose, with a bare `RestTimerActivity.tsx` no-op sibling for
// Android/web: `@expo/ui/swift-ui`'s components call into a native view
// manager that only exists on iOS — even behind a runtime `Platform.OS`
// check, the mere `import` of this file broke Android AND web bundling
// (imports execute before any runtime guard can run). Metro's platform
// extension resolution keeps the two apart at the file level instead: the
// `plan.tsx`/`_layout.tsx` call sites `import from '@/widgets/RestTimerActivity'`
// with no suffix, and Metro picks whichever of this file or the bare one
// matches the platform being bundled.
//
// IMPORTANT constraint this file must respect: expo-widgets compiles the
// `'widget'`-directive-marked layout function below into native SwiftUI at
// build time, in an isolated bundling pass that stubs out `react`,
// `react-native`, and `expo` (see expo-widgets/metro.config.js) — this file
// must therefore import ONLY from `expo-widgets` and `@expo/ui/swift-ui*`,
// never from Tempo's own theme/constants modules or any other RN code. Colors
// are hardcoded hex literals for exactly that reason.
//
// The countdown (both the ring and the digits) uses SwiftUI's native
// `timerInterval`/`countsDown` — the OS ticks these itself from the
// start/end Date pair, so this never needs a per-second JS push. That's both
// the correct ActivityKit pattern and the way to sidestep its own Live
// Activity update-rate limits (see rest-timer plumbing below).
//
// This module is imported from TWO places for two different reasons:
//   1. Here — its own layout function is compiled into the widget extension.
//   2. `(tabs)/plan.tsx` (and FocusMode's rest-adjust handlers) — call the
//      exported start/update/end/cleanup functions below to drive it from the
//      real rest timer's wall-clock `restEndsAt`, exactly where that timer
//      already lives.

import { Platform } from 'react-native'
import { Text, VStack, HStack, ProgressView } from '@expo/ui/swift-ui'
import {
  font, foregroundStyle, bold, padding, progressViewStyle, frame, tint, monospacedDigit,
} from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity, type LiveActivity, type LiveActivityEnvironment } from 'expo-widgets'

// Dark-mode blue (`Colors.dark.primary`, constants/theme.ts) — hardcoded, not
// imported (see the constraint above). Live Activities render on the Lock
// Screen's own dark, blurred material regardless of the app's light/dark
// setting, so a single fixed accent reads correctly either way.
const TEMPO_BLUE = '#4E8BFF'

export interface RestTimerActivityProps {
  exerciseName: string
  /** Epoch ms — when this rest period began. */
  startedAt: number
  /** Epoch ms — when this rest period ends. */
  endsAt: number
}

function restTimerLayout(props: RestTimerActivityProps, _environment: LiveActivityEnvironment) {
  'widget'
  const range = { lower: new Date(props.startedAt), upper: new Date(props.endsAt) }
  const ring = (size: number) => (
    <ProgressView
      timerInterval={range}
      countsDown
      modifiers={[progressViewStyle('circular'), tint(TEMPO_BLUE), frame({ width: size, height: size })]}
    />
  )
  const digits = (textStyle: 'title2' | 'largeTitle' | undefined, size: number | undefined) => (
    <Text
      timerInterval={range}
      countsDown
      modifiers={[
        font({ textStyle, size, weight: 'bold' }),
        monospacedDigit(),
        foregroundStyle(TEMPO_BLUE),
      ]}
    />
  )

  return {
    banner: (
      <HStack spacing={14} modifiers={[padding({ all: 14 })]}>
        {ring(40)}
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
            RESTING
          </Text>
          <Text modifiers={[font({ textStyle: 'headline' }), bold()]}>{props.exerciseName}</Text>
        </VStack>
        {digits('title2', undefined)}
      </HStack>
    ),
    compactLeading: ring(20),
    compactTrailing: digits(undefined, 14),
    minimal: ring(18),
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
        <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
          RESTING
        </Text>
        <Text modifiers={[font({ textStyle: 'headline', weight: 'bold' })]}>{props.exerciseName}</Text>
      </VStack>
    ),
    expandedTrailing: ring(44),
    expandedBottom: digits('largeTitle', undefined),
  }
}

// Guarded exactly like lib/haptics.ts/lib/purchases.ts: constructing the
// factory touches a native module (expo-modules-core's SharedObject binding)
// that only exists on iOS, and only once a build has actually compiled this
// dependency in — every export below is a safe no-op until then, and always
// a no-op on Android (no Live Activity equivalent exists there).
const factory = (() => {
  if (Platform.OS !== 'ios') return null
  try {
    return createLiveActivity<RestTimerActivityProps>('RestTimerActivity', restTimerLayout)
  } catch {
    return null
  }
})()

let current: LiveActivity<RestTimerActivityProps> | null = null

/** Starts the rest-timer Live Activity. Safe to call repeatedly — replaces any already-running instance. */
export function startRestActivity(exerciseName: string, endsAtMs: number, totalSec: number): void {
  if (!factory) return
  try {
    if (current) { current.end('immediate').catch(() => {}); current = null }
    current = factory.start({ exerciseName, startedAt: endsAtMs - totalSec * 1000, endsAt: endsAtMs })
  } catch {
    // A Live Activity failure must never break the real, in-app rest timer.
  }
}

/** Pushes a new end time (rest adjusted via +/-) to the already-running instance. No-ops if none is active. */
export function updateRestActivity(exerciseName: string, endsAtMs: number, totalSec: number): void {
  if (!current) return
  try {
    current.update({ exerciseName, startedAt: endsAtMs - totalSec * 1000, endsAt: endsAtMs })
  } catch { /* best-effort */ }
}

/** Ends the running instance (rest finished, cancelled, or the session ended). */
export function endRestActivity(): void {
  if (!current) return
  const c = current
  current = null
  try { c.end('immediate').catch(() => {}) } catch { /* best-effort */ }
}

/**
 * Safety net for a force-quit mid-rest: iOS auto-expires stale Activities on
 * its own timeout, but this ends any still-running instance the moment the
 * app reopens, rather than leaving a stale Lock Screen widget around longer
 * than necessary. Call once at app startup.
 */
export function endStaleRestActivities(): void {
  if (!factory) return
  try {
    for (const a of factory.getInstances()) a.end('immediate').catch(() => {})
  } catch { /* best-effort */ }
}
