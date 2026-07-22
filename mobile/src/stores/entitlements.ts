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

// devProOverride defaults to null (no override) synchronously — no storage read
// in the initializer. Zustand's create() runs this at MODULE EVALUATION TIME,
// before React mounts and before any error boundary exists; a synchronous
// SQLite-backed localStorage read here is the same "blank screen on first
// launch" hazard fixed in theme/index.tsx (see the comment there). Real users
// never have this key set at all, so defaulting to null is exactly correct for
// everyone except a tester reopening the app with an override already saved —
// see loadStoredDevProOverride() below for the after-mount correction.
export const useEntitlementStore = create<EntitlementState>((set) => ({
  proEnabled: false,
  isPro: false,
  granted: false,
  ready: false,
  tester: false,
  devProOverride: null,
  setProEnabled: (proEnabled) => set({ proEnabled }),
  setIsPro: (isPro) => set({ isPro }),
  setGranted: (granted) => set({ granted }),
  setReady: (ready) => set({ ready }),
  setTester: (tester) => set({ tester }),
  setDevProOverride: (devProOverride) => { persistOverride(devProOverride); set({ devProOverride }) },
}))

// Called once from the root layout's startup effect (after first mount) to
// restore a tester's saved override. Uses the ASYNC SQLite API (not the sync
// one persistOverride() uses for writes) so a slow/stuck native call here can
// never block first paint.
export async function loadStoredDevProOverride(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: AsyncStorage } = await import('expo-sqlite/kv-store')
    const v = await AsyncStorage.getItem(OVERRIDE_KEY)
    if (v === '1' || v === '0') useEntitlementStore.setState({ devProOverride: v === '1' })
  } catch {
    /* keep the default (no override) */
  }
}

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
/**
 * The same `locked` derivation as useProAccess(), for plain (non-hook) code —
 * background sweeps like lib/autoSchedule.ts run outside any component, so
 * they can't call a hook, but still need to know whether to apply a Pro gate.
 * Zustand stores expose `.getState()` as the documented escape hatch for
 * exactly this. Keep this in lock-step with useProAccess() above — same
 * tester-override and granted-comp handling — so a background sweep and the
 * UI it feeds never disagree about access. Named to match every other gate
 * site's own vocabulary (`locked`), not an ambiguous "isPro" that could be
 * misread as false while the whole Pro system is still dormant.
 */
export function isProLockedNow(): boolean {
  const { isPro, granted, proEnabled, tester, devProOverride } = useEntitlementStore.getState()
  if (tester && devProOverride !== null) return !devProOverride
  return proEnabled && !(isPro || granted)
}

export function useProGate(): { locked: boolean; requirePro: (context?: string) => boolean } {
  const { locked } = useProAccess()
  // Lazy requires (not static imports), matching lib/purchases-adjacent
  // patterns like components/ShareCardSheet.tsx's loadNativeShare() — this
  // file is also imported by plain lib code (lib/autoSchedule.ts's
  // isProLockedNow, for the §24/§30 L1/L2 Pro gates) that runs in contexts
  // (including the Jest unit-test suite) without expo-router's or
  // lib/analytics' full RN/PostHog dependency chains available. Static
  // top-level imports here broke those chains the moment anything imported
  // this file at all, even just for isProLockedNow — require() only resolves
  // once this hook is actually called from within a real running app.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useRouter } = require('expo-router')
  const router = useRouter()
  const requirePro = (context = 'gate'): boolean => {
    if (!locked) return true
    // Relative path (not the '@/' alias) — safer for a dynamic require, since
    // Babel's module-resolver alias transform is proven for static imports
    // throughout this codebase but not verified for require() call sites.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../lib/analytics').track('paywall_shown', { context })
    router.push({ pathname: '/paywall', params: { context } } as never)
    return false
  }
  return { locked, requirePro }
}
