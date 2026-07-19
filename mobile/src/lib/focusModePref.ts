// Tempo — "Workout Focus Mode" on/off preference.
//
// Focus Mode (the full-screen active-set/rest-timer view) is the default
// active-session experience, but some lifters just want the plain scrolling
// list. Device-local, same synchronous-localStorage + Zustand pattern as
// `units.ts`'s weight-unit store, so Settings and the runner both react to a
// change immediately (no restart needed).

import { create } from 'zustand'

const STORAGE_KEY = 'tempo.focusModeEnabled'

function readInitial(): boolean {
  try {
    const v = (globalThis as { localStorage?: Storage }).localStorage?.getItem(STORAGE_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

interface FocusModeState {
  enabled: boolean
  setEnabled: (v: boolean) => void
}

export const useFocusModePrefStore = create<FocusModeState>((set) => ({
  enabled: readInitial(),
  setEnabled: (enabled) => {
    try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(STORAGE_KEY, enabled ? '1' : '0') } catch { /* best-effort */ }
    set({ enabled })
  },
}))

/** Convenience hook — whether Focus Mode should open. */
export const useFocusModeEnabled = () => useFocusModePrefStore((s) => s.enabled)
