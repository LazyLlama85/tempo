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
import { useRouter } from 'expo-router'
import { track } from '@/lib/analytics'

interface EntitlementState {
  proEnabled: boolean
  isPro: boolean
  granted: boolean // comped Pro (pro_user_ids) — unlocks without a purchase
  ready: boolean
  tester: boolean            // may see the in-app "Tester Tools" (Pro override) — remote-gated
  devProOverride: boolean | null // tester override: null=real, true=force Pro, false=force free
  setProEnabled: (v: boolean) => void
  setIsPro: (v: boolean) => void
  setGranted: (v: boolean) => void
  setReady: (v: boolean) => void
  setTester: (v: boolean) => void
  setDevProOverride: (v: boolean | null) => void
}

// The tester override persists across launches (and survives the RevenueCat live
// listener) using the same localStorage idiom as activation.ts. Best-effort; a
// missing/broken store just means "no override" (real entitlement), never a crash.
const OVERRIDE_KEY = 'tempo.devProOverride'
function readOverride(): boolean | null {
  try {
    const v = (globalThis as { localStorage?: Storage }).localStorage?.getItem(OVERRIDE_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}
function persistOverride(v: boolean | null): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (!ls) return
    if (v === null) ls.removeItem(OVERRIDE_KEY)
    else ls.setItem(OVERRIDE_KEY, v ? '1' : '0')
  } catch {
    /* best-effort; tester tooling only */
  }
}

export const useEntitlementStore = create<EntitlementState>((set) => ({
  proEnabled: false,
  isPro: false,
  granted: false,
  ready: false,
  tester: false,
  devProOverride: readOverride(),
  setProEnabled: (proEnabled) => set({ proEnabled }),
  setIsPro: (isPro) => set({ isPro }),
  setGranted: (granted) => set({ granted }),
  setReady: (ready) => set({ ready }),
  setTester: (tester) => set({ tester }),
  setDevProOverride: (devProOverride) => { persistOverride(devProOverride); set({ devProOverride }) },
}))

/**
 * Reactive Pro access. `locked` is the single source of truth for gating a feature.
 * A granted (comped) user counts as Pro even without a RevenueCat entitlement, and
 * the grant survives live listener updates (a customerInfo push can't re-lock them).
 */
export function useProAccess(): { isPro: boolean; proEnabled: boolean; locked: boolean; ready: boolean } {
  const { isPro, granted, proEnabled, ready, tester, devProOverride } = useEntitlementStore()
  // Tester override (Profile → Tester Tools): force the Pro SYSTEM live and set this
  // device's access directly, so a tester can preview BOTH the free/paywall experience
  // (override=false) and the fully-unlocked one (override=true). Only honored while the
  // account is STILL a tester — so when `tester_tools` is turned off at public launch,
  // any lingering override goes inert and real RevenueCat entitlement governs again
  // (no former tester stuck paywalled-after-paying, or comped forever). Real users
  // never set it — it stays null — so their gating is byte-for-byte unchanged.
  if (tester && devProOverride !== null) {
    return { isPro: devProOverride, proEnabled: true, ready: true, locked: !devProOverride }
  }
  const effectivePro = isPro || granted
  return { isPro: effectivePro, proEnabled, ready, locked: proEnabled && !effectivePro }
}

/**
 * Gate a Pro feature action. Wrap a feature's entry point:
 *   const { locked, requirePro } = useProGate()
 *   const onPress = () => { if (requirePro('advanced_analytics')) doThePaidThing() }
 *
 * While dormant (proEnabled false) `locked` is false and requirePro() returns true —
 * nothing is blocked. Once live, a locked feature routes to the custom paywall and
 * returns false (the action doesn't proceed; the user completes purchase, which
 * unlocks the surface reactively, then taps again).
 */
export function useProGate(): { locked: boolean; requirePro: (context?: string) => boolean } {
  const { locked } = useProAccess()
  const router = useRouter()
  const requirePro = (context = 'gate'): boolean => {
    if (!locked) return true
    track('paywall_shown', { context })
    router.push({ pathname: '/paywall', params: { context } } as never)
    return false
  }
  return { locked, requirePro }
}
