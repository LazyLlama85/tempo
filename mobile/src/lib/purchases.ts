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
//
// The fallback is deliberately NOT used when it holds a key for the *other*
// platform. RevenueCat keys are platform-scoped (`appl_` / `goog_` / `amzn_`),
// and only the Test Store key (`test_`) is cross-platform, so handing an
// `appl_` key to the Android SDK can never work — it just fails at runtime with
// "The specified API Key is not recognized", which reads like a broken key
// rather than a missing one. That is exactly what a local Android dev build hit
// (2026-07-23): `.env.local` defines EXPO_PUBLIC_REVENUECAT_KEY as the iOS
// `appl_` key and leaves _ANDROID_KEY commented out, so the fallback silently
// mis-fired. (Real builds were unaffected — `eas.json` sets both platform keys.)
// Treating a wrong-platform key as absent means the SDK simply stays
// unconfigured, which every call site already handles gracefully via
// `purchasesReady()`.
function usableFallbackKey(): string | undefined {
  const k = process.env.EXPO_PUBLIC_REVENUECAT_KEY
  if (!k) return undefined
  const wrongPlatform = Platform.OS === 'ios' ? k.startsWith('goog_') : k.startsWith('appl_')
  return wrongPlatform ? undefined : k
}

const API_KEY =
  (Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY) ||
  usableFallbackKey()

// ── Guarded native-module load (never throws at import) ─────────────────────────
// Held loosely-typed (like lib/haptics) so this one file never breaks against a
// RevenueCat SDK version bump; the public API below is fully typed via CustomerInfo.
/* eslint-disable @typescript-eslint/no-explicit-any */
let Purchases: any = null
let RevenueCatUI: any = null
let PAYWALL_RESULT: { PURCHASED: string; RESTORED: string } | null = null
let LOG_LEVEL: { DEBUG: unknown } | null = null
try {
  // RevenueCat's mobile SDK keys (appl_/goog_) aren't valid on web — it wants a
  // separate Web Billing key Tempo doesn't have (Pro only sells via App Store/Play).
  // Skip the load entirely so every call below hits its existing !Purchases no-op,
  // instead of configure() throwing "Invalid API key. Use your Web Billing API key."
  if (Platform.OS !== 'web') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('react-native-purchases')
    Purchases = core.default ?? core
    LOG_LEVEL = core.LOG_LEVEL ?? null
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ui = require('react-native-purchases-ui')
    RevenueCatUI = ui.default ?? ui
    PAYWALL_RESULT = ui.PAYWALL_RESULT ?? null
  }
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

/**
 * Current Pro + trial status together — lets a caller (the app-open effect,
 * see _layout.tsx's trial_started/trial_converted split) seed its "was this a
 * trial" baseline without a second round trip. Fails closed, same as fetchIsPro.
 */
export async function fetchProAndTrialState(): Promise<{ isPro: boolean; isTrial: boolean }> {
  if (!configured || !Purchases) return { isPro: false, isTrial: false }
  try {
    const info = await Purchases.getCustomerInfo()
    return { isPro: infoIsPro(info), isTrial: infoHasActiveTrial(info) }
  } catch {
    return { isPro: false, isTrial: false }
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

// §24 L3 — the store distinguishes two kinds of introductory offer, and the
// paywall must never conflate them: a FREE TRIAL (price 0 for N days, then
// the list price) and a PAID intro like the $19.99 founding first year (Pay
// Up Front, a real charge, then the list price). Both come back on the same
// `product.introPrice` field — `packageHasIntroOffer` used to assume every
// intro was free (`price === 0`), which is silently wrong the moment a paid
// intro offer exists: the paywall would render the LIST price ($34.99) while
// the store actually charges $19.99. That's a conversion-killing, App-Review-
// risking bug, not a cosmetic one — fixed by splitting "has an intro offer"
// from "is that intro offer free."

export interface IntroOffer {
  isFree: boolean
  priceString: string
  price: number
  periodUnit: string // 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'
  periodNumberOfUnits: number
  cycles: number
}

/** Whether a package has ANY introductory offer — free trial or paid intro price. */
export function packageHasIntroOffer(pkg: PurchasesPackage | null | undefined): boolean {
  return !!pkg?.product.introPrice
}

/** Whether the package's intro offer (if any) is specifically a FREE trial. */
export function introIsFree(pkg: PurchasesPackage | null | undefined): boolean {
  return pkg?.product.introPrice?.price === 0
}

/** The package's intro offer, typed and normalized, or null if it has none. */
export function introOffer(pkg: PurchasesPackage | null | undefined): IntroOffer | null {
  const intro = pkg?.product.introPrice
  if (!intro) return null
  return {
    isFree: intro.price === 0,
    priceString: intro.priceString,
    price: intro.price,
    periodUnit: intro.periodUnit,
    periodNumberOfUnits: intro.periodNumberOfUnits,
    cycles: intro.cycles,
  }
}

// §pricing-mismatch (2026-08-05): a product's `introPrice` (above) describes the
// OFFER'S terms — it does NOT mean THIS user still qualifies for it. On iOS, a
// once-subscribed or already-trialed customer still gets `introPrice` back from
// the store (that's how StoreKit reports the offer's existence), but the actual
// purchase sheet then charges the real list price. Showing $24.99 on the paywall
// and charging $35 at checkout is exactly that gap — the paywall must gate its
// display on eligibility, not just on "does an intro offer exist."
export type IntroEligibilityStatus = 'eligible' | 'ineligible'

/**
 * Whether the CURRENT user is actually eligible for each product's intro/trial
 * price. iOS only — Android's Play Billing already filters ineligible offers
 * out of ProductDetails before they reach the SDK, so every id resolves
 * 'eligible' there and the store's own listing stays the source of truth.
 * Unresolvable (RevenueCat's UNKNOWN status, or any error) fails to
 * 'ineligible' — RevenueCat's own guidance: showing the non-intro price is the
 * only choice that's never misleading.
 */
export async function checkIntroEligibility(
  productIdentifiers: string[],
): Promise<Record<string, IntroEligibilityStatus>> {
  const result: Record<string, IntroEligibilityStatus> = {}
  if (!productIdentifiers.length) return result
  if (Platform.OS !== 'ios' || !configured || !Purchases) {
    for (const id of productIdentifiers) result[id] = 'eligible'
    return result
  }
  try {
    const raw = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIdentifiers)
    const ELIGIBLE = Purchases.INTRO_ELIGIBILITY_STATUS?.INTRO_ELIGIBILITY_STATUS_ELIGIBLE
    for (const id of productIdentifiers) {
      result[id] = raw?.[id]?.status === ELIGIBLE ? 'eligible' : 'ineligible'
    }
  } catch (e) {
    captureApiError('purchases.checkTrialOrIntroductoryPriceEligibility', e)
    for (const id of productIdentifiers) result[id] = 'ineligible'
  }
  return result
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
