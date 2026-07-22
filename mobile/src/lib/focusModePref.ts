// Tempo — "Workout Focus Mode" on/off preference.
//
// Focus Mode (the full-screen active-set/rest-timer view) is OPT-IN — some
// lifters want it, most just want the plain scrolling list, so it defaults off
// and stays off until a user turns it on in Settings. Device-local Zustand
// store; the persisted value is loaded post-mount (see loadStoredFocusMode()
// below), not read synchronously in the initializer — see theme/index.tsx for
// why a synchronous SQLite-backed localStorage read at module-eval time is a
// "blank screen on first launch" hazard.

import { create } from 'zustand'
import { readPref, writePref } from '@/lib/prefStorage'

const STORAGE_KEY = 'tempo.focusModeEnabled'

interface FocusModeState {
  enabled: boolean
  setEnabled: (v: boolean) => void
}

export const useFocusModePrefStore = create<FocusModeState>((set) => ({
  enabled: false,
  setEnabled: (enabled) => {
    set({ enabled })
    writePref(STORAGE_KEY, enabled ? '1' : '0')
  },
}))

/** Convenience hook — whether Focus Mode should open. */
export const useFocusModeEnabled = () => useFocusModePrefStore((s) => s.enabled)

// Called once from the root layout's startup effect (after first mount) to
// restore a user's explicit on/off choice. Defaults stay false (off) for
// anyone who never touched the setting. Uses the ASYNC SQLite API so a stuck
// native call here can never block rendering.
export async function loadStoredFocusMode(): Promise<void> {
  const v = await readPref(STORAGE_KEY)
  if (v === '1' || v === '0') useFocusModePrefStore.setState({ enabled: v === '1' })
}
