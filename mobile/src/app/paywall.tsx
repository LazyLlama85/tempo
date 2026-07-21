// Tempo — the Tempo Pro paywall (custom, on-brand, dynamic pricing).
//
// Prices, trial, and which plans exist are read LIVE from the RevenueCat "current"
// offering (lib/purchases.getProOffering) — nothing here is hardcoded, so changing
// price or swapping the offering in the dashboard reflects instantly with no build.
// Only the layout ships in the binary (and even that updates via `eas update`).
//
// Dormant-safe: this screen is only ever reached when a feature is `locked`
// (proEnabled && !isPro) or the user opens it from a live Pro entry point.
//
// §25 rebuild (2026-07-22): the old version described the product to someone who
// had already used it — a generic hero, a 6-row icon list, and a 9-row compare
// table before ever getting to a price. This version leads with the user's own
// data, shows the wedge with one animated visual instead of describing it, and
// collapses everything else so the price is reached in one scroll, not five.

import { useEffect, useMemo, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, Alert, ActivityIndicator, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases'
import { Palettes, Spacing, Radius, Elevation } from '@/constants/theme'
import type { Palette } from '@/theme'
import { ScreenHeader, DismissButton, TempoPulse } from '@/components/brand'
import { PressableScale, FadeInView, PopIn } from '@/components/motion'
import { PAYWALL_POINTS, type IoniconName } from '@/lib/proFeatures'
import {
  getProOffering, purchaseProPackage, restorePurchases, introOffer, type IntroOffer,
} from '@/lib/purchases'
import { useEntitlementStore } from '@/stores/entitlements'
import { track } from '@/lib/analytics'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { fetchSchedulingImpact, type SchedulingImpact } from '@/lib/schedulingImpact'
import { fetchFoundingOfferEndsAt } from '@/lib/proConfig'

type PlanKey = 'annual' | 'monthly'

// Always dark, regardless of the app's own light/dark setting — the cheapest
// reliable "this is the premium room" signal, and it never touches the global
// theme store (Palettes.dark is a plain constant object), so no other screen
// is affected. See §25.2.
const C: Palette = Palettes.dark

// What's actually gated today (proFeatures.ts / proLimits.ts) — the free app is
// fully functional; Pro adds foresight + automation + depth on top. The
// "Advanced analytics" row is deliberately NOT here: Free already has it, and a
// row where Free shows a checkmark is an argument against paying, printed on
// the purchase screen.
// `pro` overrides the default "∞" shown for a string free-value — right for a
// creation cap ("1 plan" → "∞"), wrong for a time-window row like the
// calendar-fit one, where the honest Pro value is "Every week," not infinity.
const COMPARE: { label: string; free: string | boolean; pro?: string }[] = [
  { label: 'Auto-scheduled workout plan', free: true },
  { label: 'Unlimited logging & full history', free: true },
  { label: 'Full 1,300+ exercise library', free: true },
  { label: 'Auto-fit around your calendar', free: 'This week', pro: 'Every week' },
  { label: 'Custom plans', free: '1' },
  { label: 'Custom workouts & exercises', free: '5 each' },
  { label: 'Auto-move on a calendar conflict', free: false },
  { label: 'Multi-calendar & travel mode', free: false },
  { label: 'Premium themes & app icons', free: false },
]

const TRUST: { icon: IoniconName; label: string }[] = [
  { icon: 'lock-closed', label: 'Secure' },
  { icon: 'shield-checkmark', label: 'Private' },
  { icon: 'close-circle', label: 'No ads' },
  { icon: 'refresh', label: 'Cancel anytime' },
]

// The trial length in DAYS (for the "how your trial works" timeline). Normalizes
// whatever unit the store reports (a 7-day trial can come back as 1 WEEK or 7 DAY).
function daysOf(offer: IntroOffer): number {
  const n = offer.periodNumberOfUnits || 0
  const unit = offer.periodUnit.toUpperCase()
  if (unit.includes('WEEK')) return n * 7
  if (unit.includes('MONTH')) return n * 30
  if (unit.includes('YEAR')) return n * 365
  return n
}

function foundingEndsLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

export default function PaywallScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ context?: string }>()
  const context = params.context ?? 'unknown'
  const setIsPro = useEntitlementStore((s) => s.setIsPro)
  const userId = useAuthStore((s) => s.session?.user.id) ?? ''

  const [offering, setOffering] = useState<PurchasesOffering | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PlanKey>('annual')
  const [busy, setBusy] = useState(false)
  const [impact, setImpact] = useState<SchedulingImpact | null>(null)
  const [foundingEndsAt, setFoundingEndsAt] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)

  // Personalized proof: how many workouts Tempo has already planned + scheduled for
  // this user. The single most persuasive element on the screen, so it leads the
  // hero rather than sitting below the fold — shown from the first real workout
  // (not held back for an arbitrary "3 scheduled" threshold).
  useEffect(() => {
    if (!userId) return
    fetchSchedulingImpact(supabase, userId).then(setImpact).catch(() => {})
  }, [userId])

  useEffect(() => {
    fetchFoundingOfferEndsAt(supabase).then(setFoundingEndsAt).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const o = await getProOffering()
      if (cancelled) return
      setOffering(o)
      // Default to annual when it exists (best value), else monthly.
      setSelected(o?.annual ? 'annual' : 'monthly')
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const annualPkg = offering?.annual ?? null
  const monthlyPkg = offering?.monthly ?? null
  const selectedPkg = selected === 'annual' ? annualPkg : monthlyPkg
  const hasPlans = !!(annualPkg || monthlyPkg)

  const annualIntro = introOffer(annualPkg)
  const selectedIntro = introOffer(selectedPkg)
  const hasFreeTrial = !!selectedIntro?.isFree
  const hasPaidIntro = !!selectedIntro && !selectedIntro.isFree

  // Savings badge: a paid intro on annual compares against the EFFECTIVE first-
  // year cost, not the list price — $19.99 vs 12×$4.99 is 67% off, a materially
  // stronger (and honest) number than list-vs-list, which is what this used to
  // compute unconditionally.
  const savingsPct = useMemo(() => {
    if (!annualPkg || !monthlyPkg || monthlyPkg.product.price <= 0) return null
    const annualEffective = annualIntro && !annualIntro.isFree ? annualIntro.price : annualPkg.product.price
    return Math.round((1 - annualEffective / (monthlyPkg.product.price * 12)) * 100)
  }, [annualPkg, monthlyPkg, annualIntro])

  const trialDays = hasFreeTrial && selectedIntro ? daysOf(selectedIntro) : null

  const close = () => {
    track('paywall_dismissed', { context })
    router.back()
  }

  const onPurchase = async () => {
    if (!selectedPkg || busy) return
    setBusy(true)
    track('purchase_started', { plan: selected, context })
    const res = await purchaseProPackage(selectedPkg)
    setBusy(false)
    if (res.cancelled) {
      track('purchase_failed', { plan: selected, reason: 'cancelled' })
      return
    }
    if (res.isPro) {
      setIsPro(true) // unlock gates instantly; the live listener will confirm
      track('purchase_completed', { plan: selected, context })
      router.back()
      return
    }
    track('purchase_failed', { plan: selected, reason: 'error' })
    Alert.alert('Purchase didn’t complete', 'Something went wrong and you were not charged. Please try again.')
  }

  const onRestore = async () => {
    if (busy) return
    setBusy(true)
    const restored = await restorePurchases()
    setBusy(false)
    track('restore_completed', { restored })
    if (restored) {
      setIsPro(true)
      Alert.alert('Tempo Pro restored', 'Your subscription is active again.', [
        { text: 'Great', onPress: () => router.back() },
      ])
    } else {
      Alert.alert('Nothing to restore', 'We couldn’t find an active subscription on this Apple ID.')
    }
  }

  const ctaLabel = hasFreeTrial
    ? 'Start Free Trial'
    : hasPaidIntro && selectedIntro
      ? `Get Pro — ${selectedIntro.priceString} for the Year`
      : 'Unlock Tempo Pro'

  const heroTitle = impact && impact.scheduledByTempo >= 1
    ? `Tempo has scheduled ${impact.scheduledByTempo} workout${impact.scheduledByTempo === 1 ? '' : 's'} around your real life.`
    : 'Train smarter.\nNever miss a workout.'
  const heroSub = impact && impact.scheduledByTempo >= 1
    ? 'Keep it doing that automatically — every week, not just this one.'
    : 'Tempo schedules your training around your life and tells you exactly what to do each day.'

  const heroPoints = PAYWALL_POINTS.slice(0, 3)
  const restPoints = PAYWALL_POINTS.slice(3)

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader
        title="Tempo Pro"
        size="sm"
        leading={<DismissButton kind="x" onPress={close} label="Close" />}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero — personalized to the user's own data when there's enough of it. */}
        <FadeInView style={styles.hero} delay={20}>
          <View style={styles.heroGlow} pointerEvents="none" />
          <View style={styles.heroBadge}>
            <TempoPulse size={26} />
          </View>
          <Text style={styles.heroTitle}>{heroTitle}</Text>
          <Text style={styles.heroSub}>{heroSub}</Text>
        </FadeInView>

        {/* The one visual — shows the wedge instead of describing it. */}
        <PopIn delay={140} style={styles.weekStripCard}>
          <WeekStrip />
          <Text style={styles.weekStripCaption}>Real events in grey. Tempo fits your training into the gaps.</Text>
        </PopIn>

        {/* Three benefit cards — outcomes, not a feature list. */}
        <View style={styles.benefitStack}>
          {heroPoints.map((p, i) => (
            <FadeInView key={p.title} delay={200 + i * 60} style={styles.benefitCard}>
              <View style={styles.benefitIcon}>
                <Ionicons name={p.icon} size={20} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{p.title}</Text>
                <Text style={styles.benefitBody}>{p.benefit}</Text>
              </View>
            </FadeInView>
          ))}
        </View>
        {restPoints.length > 0 && (
          <Text style={styles.restLine}>
            …plus {restPoints.map((p) => p.title.toLowerCase()).join(', ')}.
          </Text>
        )}

        {/* Founding-price banner — only while a real, unexpired offer exists. */}
        {foundingEndsAt && hasPaidIntro && (
          <View style={styles.foundingBanner}>
            <Ionicons name="time-outline" size={15} color={C.gold} />
            <Text style={styles.foundingBannerText}>Founding price ends {foundingEndsLabel(foundingEndsAt)}</Text>
          </View>
        )}

        {/* Plans */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={C.primary} />
            <Text style={styles.loadingText}>Loading plans…</Text>
          </View>
        ) : !hasPlans ? (
          <View style={styles.loadingBox}>
            <Ionicons name="cloud-offline-outline" size={22} color={C.textSecondary} />
            <Text style={styles.loadingText}>
              Subscriptions aren’t available right now. If you already subscribed, tap Restore below.
            </Text>
          </View>
        ) : (
          <View style={styles.plans}>
            {annualPkg && (
              <PlanOption
                label="Annual"
                price={annualIntro && !annualIntro.isFree ? annualIntro.priceString : annualPkg.product.priceString}
                strikePrice={annualIntro && !annualIntro.isFree ? annualPkg.product.priceString : undefined}
                subline={
                  annualIntro && !annualIntro.isFree
                    ? `first year · then ${annualPkg.product.priceString}/yr`
                    : annualPkg.product.pricePerMonthString
                      ? `${annualPkg.product.pricePerMonthString}/mo · billed yearly`
                      : 'Billed yearly'
                }
                badge={
                  annualIntro && !annualIntro.isFree ? 'FOUNDING PRICE'
                    : savingsPct && savingsPct > 0 ? `SAVE ${savingsPct}%`
                    : 'BEST VALUE'
                }
                selected={selected === 'annual'}
                onPress={() => setSelected('annual')}
              />
            )}
            {monthlyPkg && (
              <PlanOption
                label="Monthly"
                price={monthlyPkg.product.priceString}
                subline="Billed monthly"
                selected={selected === 'monthly'}
                onPress={() => setSelected('monthly')}
              />
            )}
          </View>
        )}

        {/* What you pay / trial timeline — offer-aware, never both at once. */}
        {hasFreeTrial && trialDays ? (
          <View style={styles.timelineCard}>
            <Text style={styles.timelineHead}>How your {trialDays}-day free trial works</Text>
            <TimelineRow icon="lock-open" title="Today" body="Unlock everything in Pro — instantly." />
            {trialDays > 2 && (
              <TimelineRow
                icon="notifications-outline"
                title={`Day ${trialDays - 2}`}
                body="We'll remind you before your trial ends."
              />
            )}
            <TimelineRow
              icon="star"
              title={`Day ${trialDays}`}
              body={`Your plan begins${selectedPkg?.product.priceString ? ` (${selectedPkg.product.priceString}${selected === 'annual' ? '/yr' : '/mo'})` : ''} — cancel anytime before.`}
              last
            />
          </View>
        ) : hasPaidIntro && selectedIntro ? (
          <View style={styles.timelineCard}>
            <Text style={styles.timelineHead}>What you pay</Text>
            <TimelineRow icon="today-outline" title="Today" body={`${selectedIntro.priceString}, everything unlocked for a year.`} />
            <TimelineRow
              icon="refresh-outline"
              title="In 12 months"
              body={`Renews at ${selectedPkg?.product.priceString}/yr — cancel anytime before.`}
              last
            />
          </View>
        ) : null}

        {/* Compare, collapsed — closed by default; the full free/Pro line for
            anyone who wants to check, not the primary sales surface. */}
        <TouchableOpacity style={styles.compareToggle} onPress={() => setCompareOpen((v) => !v)} activeOpacity={0.7}>
          <Text style={styles.compareToggleText}>Compare free and Pro</Text>
          <Ionicons name={compareOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.textSecondary} />
        </TouchableOpacity>
        {compareOpen && (
          <View style={styles.compareCard}>
            <View style={styles.compareHead}>
              <Text style={styles.compareHeadLabel}>What you get</Text>
              <Text style={styles.compareCol}>Free</Text>
              <Text style={[styles.compareCol, styles.compareColPro]}>Pro</Text>
            </View>
            {COMPARE.map((row, i) => (
              <View key={i} style={[styles.compareRow, i > 0 && styles.compareRowDivider]}>
                <Text style={styles.compareLabel}>{row.label}</Text>
                <View style={styles.compareCell}>
                  {typeof row.free === 'string'
                    ? <Text style={styles.compareFreeVal}>{row.free}</Text>
                    : row.free
                      ? <Ionicons name="checkmark" size={16} color={C.textSecondary} />
                      : <Ionicons name="remove" size={16} color={C.outlineVariant} />}
                </View>
                <View style={styles.compareCell}>
                  {typeof row.free === 'string'
                    ? row.pro
                      ? <Text style={styles.compareProValText}>{row.pro}</Text>
                      : <Text style={styles.compareProVal}>∞</Text>
                    : <Ionicons name="checkmark-circle" size={18} color={C.primary} />}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Trust indicators */}
        <View style={styles.trustRow}>
          {TRUST.map((t) => (
            <View key={t.label} style={styles.trustItem}>
              <Ionicons name={t.icon} size={15} color={C.success} />
              <Text style={styles.trustText}>{t.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Sticky CTA footer */}
      <View style={styles.footer}>
        <PressableScale
          style={[styles.cta, (!hasPlans || busy) && styles.ctaDisabled]}
          onPress={onPurchase}
          disabled={!hasPlans || busy}
          scaleTo={0.97}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          )}
        </PressableScale>

        <View style={styles.footerLinks}>
          <Text style={styles.footerLink} onPress={onRestore}>Restore</Text>
          <Text style={styles.footerDot}>·</Text>
          <Text style={styles.footerLink} onPress={() => router.push({ pathname: '/legal', params: { section: 'terms' } } as never)}>Terms</Text>
          <Text style={styles.footerDot}>·</Text>
          <Text style={styles.footerLink} onPress={() => router.push({ pathname: '/legal', params: { section: 'privacy' } } as never)}>Privacy</Text>
        </View>
        <Text style={styles.finePrint}>
          Payment is charged to your Apple ID. Subscriptions renew automatically unless cancelled at
          least 24 hours before the period ends. Manage or cancel in your App Store settings.
        </Text>
      </View>
    </SafeAreaView>
  )
}

// A seven-day strip: grey blocks are "real life", the primary-tinted block is
// where Tempo fit training into a gap. Static content (a representative week,
// not the user's literal calendar — no extra fetch, no risk of showing empty
// days for a thin account) with one entrance animation, matching §25's ask for
// something that SHOWS the product rather than another paragraph describing it.
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
// Each day: how "busy" the block reads (0-1) + whether a workout landed in the gap.
const DAY_PATTERN: { busy: number; workout: boolean }[] = [
  { busy: 0.55, workout: true }, { busy: 0.7, workout: false }, { busy: 0.35, workout: true },
  { busy: 0.6, workout: false }, { busy: 0.75, workout: true }, { busy: 0.2, workout: false },
  { busy: 0.15, workout: true },
]

function WeekStrip() {
  return (
    <View style={weekStyles.row}>
      {DAY_PATTERN.map((d, i) => (
        <View key={i} style={weekStyles.col}>
          <View style={weekStyles.track}>
            <View style={[weekStyles.busyBlock, { height: `${d.busy * 100}%` }]} />
            {d.workout && (
              <View style={[weekStyles.workoutBlock, { bottom: `${d.busy * 100 + 4}%` }]} />
            )}
          </View>
          <Text style={weekStyles.label}>{DAY_LABELS[i]}</Text>
        </View>
      ))}
    </View>
  )
}

const weekStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, height: 100, alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'center', gap: 6, height: '100%' },
  track: { width: '100%', flex: 1, borderRadius: 6, overflow: 'visible', justifyContent: 'flex-end', position: 'relative' },
  busyBlock: { width: '100%', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 6 },
  workoutBlock: { position: 'absolute', width: '100%', height: 14, backgroundColor: C.primary, borderRadius: 6 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 10.5, color: C.textSecondary },
})

function PlanOption({
  label, price, strikePrice, subline, badge, selected, onPress,
}: {
  label: string; price: string; strikePrice?: string; subline: string; badge?: string; selected: boolean; onPress: () => void
}) {
  return (
    <PressableScale
      style={[styles.plan, selected && styles.planSelected]}
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.planLabel}>{label}</Text>
        <Text style={styles.planSubline}>{subline}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        {badge && (
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>{badge}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          {strikePrice && <Text style={styles.planPriceStrike}>{strikePrice}</Text>}
          <Text style={styles.planPrice}>{price}</Text>
        </View>
      </View>
    </PressableScale>
  )
}

function TimelineRow({ icon, title, body, last }: { icon: IoniconName; title: string; body: string; last?: boolean }) {
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={styles.timelineDot}>
          <Ionicons name={icon} size={15} color={C.primary} />
        </View>
        {!last && <View style={styles.timelineLine} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : Spacing.md }}>
        <Text style={styles.timelineRowTitle}>{title}</Text>
        <Text style={styles.timelineRowBody}>{body}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { padding: Spacing.containerPadding, paddingBottom: Spacing.lg, gap: Spacing.lg },

  hero: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm },
  heroBadge: {
    width: 64, height: 64, borderRadius: Radius.full, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs,
  },
  heroGlow: { position: 'absolute', top: -24, left: '50%', width: 220, height: 220, borderRadius: 110, marginLeft: -110, backgroundColor: C.primaryGlow },
  heroTitle: { fontFamily: C.fontDisplay, fontSize: 30, color: C.text, letterSpacing: -0.6, textAlign: 'center', lineHeight: 35 },
  heroSub: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, textAlign: 'center', lineHeight: 22, paddingHorizontal: Spacing.md },

  weekStripCard: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, ...Elevation.e1 },
  weekStripCaption: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary, textAlign: 'center', marginTop: Spacing.sm },

  benefitStack: { gap: Spacing.sm },
  benefitCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, padding: Spacing.md, ...Elevation.e1,
  },
  benefitIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  benefitTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  benefitBody: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18, marginTop: 1 },
  restLine: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 18, paddingHorizontal: Spacing.xs, marginTop: -Spacing.sm },

  foundingBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(217,161,59,0.14)', borderRadius: Radius.md, paddingVertical: 8,
  },
  foundingBannerText: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: C.gold },

  loadingBox: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.lg },
  loadingText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19 },

  plans: { gap: Spacing.sm },
  plan: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 2, borderColor: 'transparent',
    ...Elevation.e1,
  },
  planSelected: {
    borderColor: C.primary, backgroundColor: C.primarySoft,
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  radio: {
    width: 22, height: 22, borderRadius: Radius.full, borderWidth: 2, borderColor: C.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: C.primary, backgroundColor: C.primary },
  planLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  planSubline: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, marginTop: 1 },
  planPrice: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3 },
  planPriceStrike: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, textDecorationLine: 'line-through' },
  planBadge: { backgroundColor: C.gold, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  planBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: '#1b1400', letterSpacing: 0.5 },

  timelineCard: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, ...Elevation.e1, padding: Spacing.lg, paddingBottom: Spacing.md },
  timelineHead: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, marginBottom: Spacing.md },
  timelineRow: { flexDirection: 'row', gap: Spacing.md },
  timelineRail: { alignItems: 'center', width: 32 },
  timelineDot: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  timelineLine: { flex: 1, width: 2, backgroundColor: C.outlineVariant, marginVertical: 2 },
  timelineRowTitle: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.text },
  timelineRowBody: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18, marginTop: 1 },

  compareToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  compareToggleText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: C.textSecondary },
  compareCard: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, ...Elevation.e1, paddingHorizontal: Spacing.md, paddingBottom: Spacing.xs },
  compareHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: C.outlineVariant },
  compareHeadLabel: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, textTransform: 'uppercase' },
  compareCol: { width: 46, textAlign: 'center', fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.4 },
  compareColPro: { color: C.primary },
  compareRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm + 1 },
  compareRowDivider: { borderTopWidth: 1, borderTopColor: C.surfaceContainerHigh },
  compareLabel: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13.5, color: C.text },
  compareCell: { width: 46, alignItems: 'center' },
  compareFreeVal: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary },
  compareProVal: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.primary, lineHeight: 20 },
  compareProValText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, textAlign: 'center', lineHeight: 14 },

  trustRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: Spacing.md, marginTop: 2 },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trustText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.sm, gap: Spacing.sm, borderTopWidth: 1, borderTopColor: C.outlineVariant },
  cta: { backgroundColor: C.primary, borderRadius: Radius.lg, paddingVertical: Spacing.md, alignItems: 'center', justifyContent: 'center', minHeight: 52, ...Elevation.e2 },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#fff', letterSpacing: 0.2 },
  footerLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  footerLink: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary },
  footerDot: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.outline },
  finePrint: { fontFamily: 'Inter_400Regular', fontSize: 10.5, color: C.outline, textAlign: 'center', lineHeight: 15 },
})
