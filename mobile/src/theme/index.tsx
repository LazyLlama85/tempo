// Tempo — runtime theme engine (dark / light).
//
// Every screen reads its palette through `useTheme()` and builds its StyleSheet with
// `useThemedStyles(makeStyles)`, so flipping the mode re-renders the whole app live.
// The mode is persisted (default dark) and the switch is masked by a soft dissolve
// overlay (`ThemeTransitionOverlay`) so it feels smooth instead of an instant snap.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, AccessibilityInfo } from 'react-native'
import { create } from 'zustand'
import { Palettes, type Palette, type ThemeMode } from '@/constants/theme'

export type { Palette, ThemeMode }

const STORAGE_KEY = 'tempo.theme.mode'

// Synchronous read from the SQLite-backed localStorage polyfill (installed with
// supabase) so there's no theme flash on launch. Defaults to dark.
function readInitialMode(): ThemeMode {
  try {
    const v = (globalThis as { localStorage?: Storage }).localStorage?.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'dark'
  } catch {
    return 'dark'
  }
}

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readInitialMode(),
  setMode: (mode) => {
    try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(STORAGE_KEY, mode) } catch { /* best-effort */ }
    set({ mode })
  },
  toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
}))

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
