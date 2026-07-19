// Tempo — RevenueCat (Tempo Pro) SDK wrapper.
//
// The ONLY module that touches react-native-purchases / -ui. Everything is guarded
// exactly like lib/haptics: the packages are `require`d in a try/catch and every
// call checks for the module first, so a JS reload on a dev client built BEFORE the
// native module was added (or Expo Go) degrades to silent no-ops instead of a
// redbox. All entitlement reads fail *closed* (return false / not-pro) so a broken
// SDK never accidentally unlocks Pro.
//
// Pro ships DORMANT (see lib/proConfig): while the remote flag is off, nothing here
// is ever reached in a way the user sees — no paywall renders, no gate blocks.
//
// Identifiers you must match to your RevenueCat dashboard:
//   • The entitlement identifier — EXPO_PUBLIC_PRO_ENTITLEMENT (defaults 'pro').
//   • The public SDK key(s) — EXPO_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY, or the
//     cross-platform Test Store key EXPO_PUBLIC_REVENUECAT_KEY as a fallback.
// Offerings/products are read from your "current" offering — no product IDs are
// hardcoded here, so lifetime/yearly/monthly are configured entirely in the dashboard.

import { Platform } from 'react-native'
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases'
import { captureApiError, captureException } from '@/lib/crashReporting'

// The entitlement that unlocks Pro. Change via env to match your dashboard.
export const PRO_ENTITLEMENT = process.env.EXPO_PUBLIC_PRO_ENTITLEMENT || 'pro'

// Platform SDK key, falling back to the cross-platform Test Store key so wiring
// works before the real appl_/goog_ keys are set.
const API_KEY =
  (Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY) ||
  process.env.EXPO_PUBLIC_REVENUECAT_KEY

// ── Guarded native-module load (never throws at import) ─────────────────────────
// Held loosely-typed (like lib/haptics) so this one file never breaks against a
// RevenueCat SDK version bump; the public API below is fully typed via CustomerInfo.
/* eslint-disable @typescript-eslint/no-explicit-any */
let Purchases: any = null
let RevenueCatUI: any = null
let PAYWALL_RESULT: { PURCHASED: string; RESTORED: string } | null = null
let LOG_LEVEL: { DEBUG: unknown } | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const core = require('react-native-purchases')
  Purchases = core.default ?? core
  LOG_LEVEL = core.LOG_LEVEL ?? null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ui = require('react-native-purchases-ui')
  RevenueCatUI = ui.default ?? ui
  PAYWALL_RESULT = ui.PAYWALL_RESULT ?? null
} catch {
  Purchases = null // native module not in this binary → all calls below no-op
}

let configured = false

/** Whether the SDK is present and configured (a real device build with the key set). */
export function isPurchasesReady(): boolean {
  return configured && !!Purchases
}

/** Configure RevenueCat once at startup. Anonymous until identifyPurchases() runs. */
export function configurePurchases(): void {
  if (configured || !Purchases || !API_KEY) return
  try {
    if (__DEV__ && LOG_LEVEL) Purchases.setLogLevel(LOG_LEVEL.DEBUG as never)
    Purchases.configure({ apiKey: API_KEY })
    configured = true
  } catch (e) {
    captureApiError('purchases.configure', e)
  }
}

/** Tie RevenueCat's app-user to the Supabase user id so entitlements follow the account. */
export async function identifyPurchases(userId: string): Promise<void> {
  if (!configured || !Purchases) return
  try {
    await Purchases.logIn(userId)
  } catch (e) {
    captureApiError('purchases.logIn', e)
  }
}

/** Drop back to an anonymous RevenueCat user on sign-out. */
export async function resetPurchasesUser(): Promise<void> {
  if (!configured || !Purchases) return
  try {
    await Purchases.logOut()
  } catch {
    // logOut throws for an already-anonymous user — not an error worth surfacing.
  }
}

// MASTER_FIX_PLAN.md F9a: EXPO_PUBLIC_PRO_ENTITLEMENT (eas.json) is a display-
// style string ("Tempo: Fitness Planner Pro"); RevenueCat entitlement
// identifiers are conventionally short slugs. If the dashboard's real
// identifier doesn't match this constant exactly, every purchase succeeds
// and NOTHING here ever unlocks — silently, forever, with zero signal. This
// can't be guessed or auto-corrected (only the founder can check the
// dashboard), but it can be made loud: if the user has ANY active
// entitlement but none match PRO_ENTITLEMENT, that's exactly this bug's
// signature — report it so it surfaces in Sentry instead of just looking
// like "conversion is low."
function reportPossibleEntitlementMismatch(info: CustomerInfo): void {
  const activeIds = Object.keys(info.entitlements.active)
  if (activeIds.length > 0 && !activeIds.includes(PRO_ENTITLEMENT)) {
    captureException(
      new Error('RevenueCat entitlement mismatch: user has active entitlement(s) but none match EXPO_PUBLIC_PRO_ENTITLEMENT'),
      { configuredEntitlement: PRO_ENTITLEMENT, activeEntitlementIds: activeIds },
    )
  }
}

function infoIsPro(info: CustomerInfo): boolean {
  const isPro = !!info.entitlements.active[PRO_ENTITLEMENT]
  if (!isPro) reportPossibleEntitlementMismatch(info)
  return isPro
}

/** True when the entitlement is currently in a free-trial period (for analytics). */
export function infoHasActiveTrial(info: CustomerInfo): boolean {
  const ent = info.entitlements.active[PRO_ENTITLEMENT]
  return !!ent && String(ent.periodType) === 'TRIAL'
}

/** Current Pro status. Fails closed (false) on any error. */
export async function fetchIsPro(): Promise<boolean> {
  if (!configured || !Purchases) return false
  try {
    return infoIsPro(await Purchases.getCustomerInfo())
  } catch {
    return false
  }
}

/** Subscribe to live entitlement changes (purchases, renewals, expirations). */
export function addProUpdateListener(cb: (isPro: boolean, info: CustomerInfo) => void): () => void {
  if (!configured || !Purchases) return () => {}
  const handler = (info: CustomerInfo) => cb(infoIsPro(info), info)
  Purchases.addCustomerInfoUpdateListener(handler)
  return () => {
    try {
      Purchases?.removeCustomerInfoUpdateListener(handler)
    } catch {
      /* listener already gone */
    }
  }
}

/** Restore prior purchases (App Store / Play). Returns whether the user is now Pro. */
export async function restorePurchases(): Promise<boolean> {
  if (!configured || !Purchases) return false
  try {
    return infoIsPro(await Purchases.restorePurchases())
  } catch (e) {
    captureApiError('purchases.restore', e)
    return false
  }
}

// ── Offerings + purchase (the custom Tempo paywall reads these) ──────────────────
// No product IDs or prices are hardcoded: the paywall renders whatever the "current"
// offering in the RevenueCat dashboard contains, so pricing/trial/offer changes take
// effect with zero app changes. Returns null when the SDK isn't present (dev/Expo Go)
// or no offering is configured — the paywall degrades to a graceful unavailable state.
export async function getProOffering(): Promise<PurchasesOffering | null> {
  if (!configured || !Purchases) return null
  try {
    const offerings = await Purchases.getOfferings()
    return offerings?.current ?? null
  } catch (e) {
    captureApiError('purchases.getOfferings', e)
    return null
  }
}

export interface PurchaseResult {
  ok: boolean        // the purchase call completed without error
  isPro: boolean     // the user now holds the Pro entitlement
  cancelled: boolean // the user dismissed the native purchase sheet
}

/** Buy a package. Distinguishes a real failure from a user cancel so the UI stays quiet on cancel. */
export async function purchaseProPackage(pkg: PurchasesPackage): Promise<PurchaseResult> {
  if (!configured || !Purchases) return { ok: false, isPro: false, cancelled: false }
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg)
    return { ok: true, isPro: infoIsPro(customerInfo), cancelled: false }
  } catch (e) {
    // RevenueCat sets userCancelled on the error when the user backs out of the sheet.
    if ((e as { userCancelled?: boolean })?.userCancelled) return { ok: false, isPro: false, cancelled: true }
    captureApiError('purchases.purchasePackage', e)
    return { ok: false, isPro: false, cancelled: false }
  }
}

/** Whether a package grants a free trial / intro offer the current user is eligible to see. */
export function packageHasIntroOffer(pkg: PurchasesPackage | null | undefined): boolean {
  return !!pkg && !!pkg.product.introPrice && pkg.product.introPrice.price === 0
}

// ── Paywall + Customer Center (react-native-purchases-ui) ───────────────────────

/** Present the RevenueCat paywall for the current offering. Returns whether the user converted. */
export async function presentPaywall(): Promise<boolean> {
  if (!RevenueCatUI || !PAYWALL_RESULT) return false
  try {
    const result = await RevenueCatUI.presentPaywall()
    return result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED
  } catch (e) {
    captureApiError('purchases.presentPaywall', e)
    return false
  }
}

/** Present the paywall only if the user lacks Pro. Returns whether they now have access. */
export async function presentPaywallIfNeeded(): Promise<boolean> {
  if (!RevenueCatUI || !PAYWALL_RESULT) return false
  try {
    const result = await RevenueCatUI.presentPaywallIfNeeded({ requiredEntitlementIdentifier: PRO_ENTITLEMENT })
    return result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED
  } catch (e) {
    captureApiError('purchases.presentPaywallIfNeeded', e)
    return false
  }
}

/** Present the RevenueCat Customer Center (manage/cancel/restore, request refunds). */
export async function presentCustomerCenter(): Promise<void> {
  if (!RevenueCatUI) return
  try {
    await RevenueCatUI.presentCustomerCenter()
  } catch (e) {
    captureApiError('purchases.customerCenter', e)
  }
}
