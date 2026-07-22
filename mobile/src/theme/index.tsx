// Tempo — runtime theme engine (dark / light).
//
// Every screen reads its palette through `useTheme()` and builds its StyleSheet with
// `useThemedStyles(makeStyles)`, so flipping the mode re-renders the whole app live.
// The mode is persisted (default dark) and the switch is masked by a soft dissolve
// overlay (`ThemeTransitionOverlay`) so it feels smooth instead of an instant snap.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, AccessibilityInfo } from 'react-native'
import { create } from 'zustand'
import { readPref, writePref } from '@/lib/prefStorage'
import { Palettes, type Palette, type ThemeMode } from '@/constants/theme'

export type { Palette, ThemeMode }

const STORAGE_KEY = 'tempo.theme.mode'

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

// Defaults to dark synchronously — no storage read in the initializer. This
// store is created at MODULE EVALUATION TIME (Zustand's create() runs its
// initializer immediately, and this file is imported from the app's root
// layout), which is before React has mounted and before any error boundary
// exists. A synchronous SQLite-backed localStorage read here used to be the
// very first thing the app did on a truly fresh install — and expo-sqlite's
// synchronous JSI API opening/migrating the database for the first time is a
// documented class of "blank screen on first launch, works after force-quit"
// bug (a stuck/slow synchronous native call blocks the JS thread before
// React ever renders a single frame, so there's nothing an error boundary or
// a timeout can rescue — JS timers can't fire while the thread itself is
// blocked). See loadStoredThemeMode() below for the real fix: the same read,
// moved to run AFTER first paint, via the async API so a slow native call
// can never block rendering even if it does happen.
export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'dark',
  setMode: (mode) => {
    set({ mode })
    writePref(STORAGE_KEY, mode)
  },
  toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
}))

// Called once from the root layout's startup effect (after first mount) to
// correct the mode for a returning user with a saved 'light' preference.
// Reads via lib/prefStorage, which is ASYNC on purpose: a stuck promise here
// can never freeze the JS thread or block rendering, unlike a stuck
// synchronous call. prefStorage also writes through both storage paths, so a
// value saved by setMode is always found here (they used to disagree — see
// that module's header).
export async function loadStoredThemeMode(): Promise<void> {
  const v = await readPref(STORAGE_KEY)
  if (v === 'light' || v === 'dark') useThemeStore.setState({ mode: v })
}

/** The active palette. Re-renders the caller when the mode changes. */
export function useTheme(): Palette {
  const mode = useThemeStore((s) => s.mode)
  return Palettes[mode]
}

/** `{ mode, setMode, toggle }` for the settings switch. */
export function useThemeMode() {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  const toggle = useThemeStore((s) => s.toggle)
  return { mode, setMode, toggle }
}

/**
 * Build a StyleSheet from the active palette, memoized per mode.
 * Usage: `const styles = useThemedStyles(makeStyles)` where
 * `const makeStyles = (C: Palette) => StyleSheet.create({...})`.
 */
export function useThemedStyles<T>(factory: (c: Palette) => T): T {
  const c = useTheme()
  return useMemo(() => factory(c), [c])
}

/**
 * A full-screen overlay that briefly covers the app with the OUTGOING surface color
 * and dissolves to reveal the new theme — a smooth crossfade with no snapshot lib.
 * Honors Reduce Motion (instant). Mount once near the root, above the navigator.
 */
export function ThemeTransitionOverlay() {
  const mode = useThemeStore((s) => s.mode)
  const opacity = useRef(new Animated.Value(0)).current
  const prevMode = useRef(mode)
  const prevSurface = useRef(Palettes[mode].surface)
  const [coverColor, setCoverColor] = useState(Palettes[mode].surface)

  useLayoutEffect(() => {
    if (prevMode.current === mode) return
    const fromSurface = prevSurface.current
    prevMode.current = mode
    prevSurface.current = Palettes[mode].surface
    setCoverColor(fromSurface)
    opacity.setValue(1)

    let cancelled = false
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled) return
        if (reduce) { opacity.setValue(0); return }
        Animated.timing(opacity, {
          toValue: 0,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start()
      })
      .catch(() => opacity.setValue(0))

    return () => { cancelled = true }
  }, [mode, opacity])

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: coverColor, opacity, zIndex: 9999 }]}
    />
  )
}
