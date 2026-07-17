// Tempo — whether a live workout session is in progress right now.
//
// Quick Workout's GO tab button is a genuine "I only have X minutes" escape
// hatch, not an alternative to the session you're already doing — showing it
// mid-workout reads as the app not knowing what you're currently doing. This
// is a one-boolean store (not component state) because the runner and the tab
// bar are siblings, not parent/child — TempoTabBar has no other way to know.

import { create } from 'zustand'

interface SessionActiveState {
  active: boolean
  setActive: (v: boolean) => void
}

export const useSessionActiveStore = create<SessionActiveState>((set) => ({
  active: false,
  setActive: (v) => set({ active: v }),
}))
