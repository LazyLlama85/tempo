// Tempo — pure resolution of "which packages can the paywall actually sell?"
//
// Split out of lib/purchases.ts so it can be unit-tested: that module `require`s
// the RevenueCat native SDK at import time, which the deterministic-core Jest
// suite (jest.config.js — "no React Native") deliberately can't load. Everything
// here is a pure function over the shape RevenueCat's `getOfferings()` returns.
//
// WHY THIS EXISTS AT ALL (2026-08-19). The paywall used to read exactly two
// fields — `offerings.current`, then `.annual` / `.monthly` — and turn anything
// else into `null`, i.e. the dead-end "Subscriptions aren't available right now"
// screen with no retry and no way to tell which of several unrelated causes had
// fired. Two of those causes are silent misconfigurations that look identical
// from outside the device:
//
//   • No offering is marked "current" in the RevenueCat dashboard, while a
//     perfectly good offering sits in `offerings.all`.
//   • The offering's packages were created with CUSTOM identifiers rather than
//     RevenueCat's predefined `$rc_annual` / `$rc_monthly`. `availablePackages`
//     is then fully populated while `offering.annual` and `offering.monthly` are
//     both null — products loaded, and the paywall still shows nothing to buy.
//
// Both are recoverable by looking one level deeper, which is what this does; the
// remaining failures are reported with a specific reason instead of a null.

/** Why no purchasable plan could be resolved. `null` on the success path. */
export type PlansUnavailableReason =
  /** SDK not present in this binary, or `configurePurchases()` never succeeded. */
  | 'sdk_unavailable'
  /** `getOfferings()` threw on every attempt (network / RevenueCat outage). */
  | 'fetch_error'
  /** The fetch succeeded but the dashboard exposes no offering at all. */
  | 'no_offering'
  /**
   * An offering exists but carries zero packages — this is the store refusing to
   * return the products, not a RevenueCat problem: Paid Apps Agreement not in
   * effect, the subscription not "Ready to Submit", or a bundle-id / product-id
   * mismatch. Worth distinguishing because the fix is in App Store Connect.
   */
  | 'no_packages'
  /** Packages exist but none resolve to an annual or monthly subscription. */
  | 'no_subscriptions'

// Structurally-typed mirrors of the RevenueCat shapes this file needs. Kept
// minimal (rather than importing PurchasesOffering) so the pure logic and its
// tests never pull in the SDK's type graph; lib/purchases.ts casts the real
// objects through, which type-checks because the real shapes are supersets.
export interface PlanPackageLike {
  identifier: string
  packageType: string
  product: { subscriptionPeriod?: string | null }
}
export interface PlanOfferingLike {
  identifier: string
  availablePackages: PlanPackageLike[]
  annual?: PlanPackageLike | null
  monthly?: PlanPackageLike | null
}
export interface PlanOfferingsLike {
  current?: PlanOfferingLike | null
  all?: Record<string, PlanOfferingLike>
}

export interface ResolvedPlans<P extends PlanPackageLike, O extends PlanOfferingLike> {
  offering: O | null
  annual: P | null
  monthly: P | null
  reason: PlansUnavailableReason | null
  /** Diagnostics for the analytics event — never rendered. */
  offeringId: string | null
  packageCount: number
}

const hasPackages = (o: PlanOfferingLike | null | undefined) =>
  !!o && (o.availablePackages?.length ?? 0) > 0

/**
 * The "current" offering when it actually has products; otherwise any offering
 * that does. Falls back to `current` so an empty-but-real offering is still
 * reported as `no_packages` rather than the misleading `no_offering`.
 */
export function chooseOffering<O extends PlanOfferingLike>(
  offerings: { current?: O | null; all?: Record<string, O> },
): O | null {
  if (hasPackages(offerings.current)) return offerings.current ?? null
  const withProducts = Object.values(offerings.all ?? {}).find(hasPackages)
  return withProducts ?? offerings.current ?? null
}

// ISO-8601 subscription periods — the last-resort match for a package that uses
// both a custom identifier AND an UNKNOWN/CUSTOM packageType. The two lists are
// disjoint by construction, so the annual and monthly lookups can never resolve
// to the same product through this path.
const ANNUAL_PERIODS = ['P1Y', 'P12M', 'P365D']
const MONTHLY_PERIODS = ['P1M', 'P30D']

function pickPackage<P extends PlanPackageLike>(
  packages: P[],
  direct: P | null | undefined,
  packageType: string,
  periods: string[],
): P | null {
  if (direct) return direct
  return (
    packages.find((p) => String(p.packageType) === packageType) ??
    packages.find((p) => periods.includes(String(p.product?.subscriptionPeriod ?? '').toUpperCase())) ??
    null
  )
}

/** Resolve the annual + monthly Pro packages from a fetched offerings payload. */
export function resolveProPlans<P extends PlanPackageLike, O extends PlanOfferingLike & { availablePackages: P[]; annual?: P | null; monthly?: P | null }>(
  offerings: { current?: O | null; all?: Record<string, O> } | null,
): ResolvedPlans<P, O> {
  const none = { offering: null, annual: null, monthly: null, offeringId: null, packageCount: 0 }
  if (!offerings) return { ...none, reason: 'fetch_error' }

  const offering = chooseOffering(offerings)
  if (!offering) return { ...none, reason: 'no_offering' }

  const packages = offering.availablePackages ?? []
  const base = { offering, offeringId: offering.identifier, packageCount: packages.length }
  if (packages.length === 0) return { ...base, annual: null, monthly: null, reason: 'no_packages' }

  const annual = pickPackage(packages, offering.annual, 'ANNUAL', ANNUAL_PERIODS)
  let monthly = pickPackage(packages, offering.monthly, 'MONTHLY', MONTHLY_PERIODS)
  // Belt and braces: never render the same product twice under two labels.
  if (annual && monthly && monthly.identifier === annual.identifier) monthly = null

  if (!annual && !monthly) return { ...base, annual: null, monthly: null, reason: 'no_subscriptions' }
  return { ...base, annual, monthly, reason: null }
}
