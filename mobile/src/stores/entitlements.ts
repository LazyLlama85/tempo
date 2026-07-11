// Tempo — entitlement store (Tempo Pro access state).
//
// Two independent facts drive every gate in the app:
//   • proEnabled — the remote dormant flag (lib/proConfig). While false, Pro is
//     INERT: no paywall, no gate. This is what keeps the public v1 free-only.
//   • isPro      — the RevenueCat entitlement (lib/purchases). Whether THIS user
//     has actually paid.
//
// A feature is "locked" only when Pro is live AND the user hasn't bought it:
//   locked = proEnabled && !isPro
// So while dormant, `locked` is always false and `useProGate().locked` unlocks
// everything — the free app is unchanged until you flip the flag.

import { create } from 'zustand'
import { presentPaywall } from '@/lib/purchases'

interface EntitlementState {
  proEnabled: boolean
  isPro: boolean
  ready: boolean
  setProEnabled: (v: boolean) => void
  setIsPro: (v: boolean) => void
  setReady: (v: boolean) => void
}

export const useEntitlementStore = create<EntitlementState>((set) => ({
  proEnabled: false,
  isPro: false,
  ready: false,
  setProEnabled: (proEnabled) => set({ proEnabled }),
  setIsPro: (isPro) => set({ isPro }),
  setReady: (ready) => set({ ready }),
}))

/** Reactive Pro access. `locked` is the single source of truth for gating a feature. */
export function useProAccess(): { isPro: boolean; proEnabled: boolean; locked: boolean; ready: boolean } {
  const { isPro, proEnabled, ready } = useEntitlementStore()
  return { isPro, proEnabled, ready, locked: proEnabled && !isPro }
}

/**
 * Gate a Pro feature. Wrap a feature's entry point:
 *   const { locked, requirePro } = useProGate()
 *   const onPress = async () => { if (await requirePro()) doThePaidThing() }
 * While dormant (proEnabled false) `locked` is false and requirePro() resolves true
 * immediately — nothing is blocked. Once live, a locked feature shows the paywall
 * and only proceeds if the user converts.
 */
export function useProGate(): { locked: boolean; requirePro: () => Promise<boolean> } {
  const { locked } = useProAccess()
  const requirePro = async (): Promise<boolean> => {
    if (!locked) return true
    return presentPaywall()
  }
  return { locked, requirePro }
}
