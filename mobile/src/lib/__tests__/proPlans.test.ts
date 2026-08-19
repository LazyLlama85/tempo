// Regression cover for the 2026-08-19 founder report: the paywall showed
// "Subscriptions aren't available right now" (with a greyed-out CTA and no way
// to retry) minutes after a purchase sheet had opened fine on the same device.
//
// The old resolution read exactly two fields — `offerings.current`, then
// `.annual` / `.monthly` — so several unrelated conditions all produced the same
// unrecoverable screen. These tests pin the fallbacks that recover the two
// silent misconfigurations, and pin that every remaining failure reports a
// SPECIFIC reason (the thing that made the original report undiagnosable
// without a physical device).

import { resolveProPlans, type PlanOfferingLike, type PlanPackageLike } from '@/lib/proPlans'

const pkg = (identifier: string, packageType: string, subscriptionPeriod: string | null): PlanPackageLike => ({
  identifier,
  packageType,
  product: { subscriptionPeriod },
})

const annualStd = pkg('$rc_annual', 'ANNUAL', 'P1Y')
const monthlyStd = pkg('$rc_monthly', 'MONTHLY', 'P1M')

const offering = (o: Partial<PlanOfferingLike> & { identifier: string }): PlanOfferingLike => ({
  availablePackages: [],
  annual: null,
  monthly: null,
  ...o,
})

const standard = offering({
  identifier: 'default',
  availablePackages: [annualStd, monthlyStd],
  annual: annualStd,
  monthly: monthlyStd,
})

describe('resolveProPlans', () => {
  it('resolves both plans from a normally configured current offering', () => {
    const r = resolveProPlans({ current: standard, all: { default: standard } })
    expect(r.reason).toBeNull()
    expect(r.annual?.identifier).toBe('$rc_annual')
    expect(r.monthly?.identifier).toBe('$rc_monthly')
    expect(r.offeringId).toBe('default')
    expect(r.packageCount).toBe(2)
  })

  it('falls back to an offering in `all` when none is marked current', () => {
    // Dashboard state: the offering exists and is fully populated, but nothing
    // is set as "current". The old code returned null here — a paywall with
    // nothing to buy despite a correctly configured product.
    const r = resolveProPlans({ current: null, all: { default: standard } })
    expect(r.reason).toBeNull()
    expect(r.offeringId).toBe('default')
  })

  it('falls back past an empty current offering to one that has packages', () => {
    const empty = offering({ identifier: 'empty' })
    const r = resolveProPlans({ current: empty, all: { empty, default: standard } })
    expect(r.reason).toBeNull()
    expect(r.offeringId).toBe('default')
  })

  it('resolves packages created with CUSTOM identifiers, which leave .annual/.monthly null', () => {
    // The failure mode with no outward symptom: products load, availablePackages
    // is populated, and both typed accessors are null because the packages
    // weren't created with RevenueCat's predefined identifiers.
    const custom = offering({
      identifier: 'founding',
      availablePackages: [pkg('yearly_founding', 'ANNUAL', 'P1Y'), pkg('month', 'MONTHLY', 'P1M')],
    })
    const r = resolveProPlans({ current: custom })
    expect(r.reason).toBeNull()
    expect(r.annual?.identifier).toBe('yearly_founding')
    expect(r.monthly?.identifier).toBe('month')
  })

  it('falls back to the subscription period when even packageType is CUSTOM', () => {
    const custom = offering({
      identifier: 'founding',
      availablePackages: [pkg('yearly', 'CUSTOM', 'P12M'), pkg('m', 'CUSTOM', 'P30D')],
    })
    const r = resolveProPlans({ current: custom })
    expect(r.annual?.identifier).toBe('yearly')
    expect(r.monthly?.identifier).toBe('m')
  })

  it('never labels one product as both plans', () => {
    const onlyAnnual = offering({
      identifier: 'annual-only',
      availablePackages: [pkg('yearly', 'ANNUAL', 'P1Y')],
    })
    const r = resolveProPlans({ current: onlyAnnual })
    expect(r.reason).toBeNull()
    expect(r.annual?.identifier).toBe('yearly')
    expect(r.monthly).toBeNull()
  })

  it('reports fetch_error when the offerings fetch failed outright', () => {
    expect(resolveProPlans(null).reason).toBe('fetch_error')
  })

  it('reports no_offering when the dashboard exposes none', () => {
    expect(resolveProPlans({ current: null, all: {} }).reason).toBe('no_offering')
  })

  it('reports no_packages when the store returned no products for a real offering', () => {
    // This is the App Store Connect signature (agreement not in effect, product
    // not Ready to Submit, bundle-id mismatch) — distinct from every other
    // cause, and the reason the founder needs to see to know where to look.
    const empty = offering({ identifier: 'default' })
    const r = resolveProPlans({ current: empty, all: { default: empty } })
    expect(r.reason).toBe('no_packages')
    expect(r.offeringId).toBe('default')
  })

  it('reports no_subscriptions when packages exist but none are annual or monthly', () => {
    const lifetimeOnly = offering({
      identifier: 'default',
      availablePackages: [pkg('lifetime', 'LIFETIME', null)],
    })
    const r = resolveProPlans({ current: lifetimeOnly })
    expect(r.reason).toBe('no_subscriptions')
    expect(r.packageCount).toBe(1)
  })
})
