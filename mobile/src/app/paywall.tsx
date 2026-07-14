// Tempo — the Tempo Pro paywall (custom, on-brand, dynamic pricing).
//
// Prices, trial, and which plans exist are read LIVE from the RevenueCat "current"
// offering (lib/purchases.getProOffering) — nothing here is hardcoded, so changing
// price or swapping the offering in the dashboard reflects instantly with no build.
// Only the layout ships in the binary (and even that updates via `eas update`).
//
// Dormant-safe: this screen is only ever reached when a feature is `locked`
// (proEnabled && !isPro) or the user opens it from a live Pro entry point.

import { useEffect, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases'
import { Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { ScreenHeader, DismissButton, TempoPulse } from '@/components/brand'
import { PressableScale, FadeInView } from '@/components/motion'
import { PAYWALL_POINTS } from '@/lib/proFeatures'
import {
  getProOffering, purchaseProPackage, restorePurchases, packageHasIntroOffer,
} from '@/lib/purchases'
import { useEntitlementStore } from '@/stores/entitlements'
import { track } from '@/lib/analytics'

type PlanKey = 'annual' | 'monthly'

function trialLabel(pkg: PurchasesPackage | null): string | null {
  const intro = pkg?.product.introPrice
  if (!intro || intro.price !== 0) return null
  const n = intro.periodNumberOfUnits
  const unit = String(intro.periodUnit || '').toLowerCase().replace(/s$/, '')
  const pretty = unit === 'day' ? 'day' : unit === 'week' ? 'week' : unit === 'month' ? 'month' : unit || 'day'
  return `${n}-${pretty}${n === 1 ? '' : 's'} free`
}

export default function PaywallScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const params = useLocalSearchParams<{ context?: string }>()
  const context = params.context ?? 'unknown'
  const setIsPro = useEntitlementStore((s) => s.setIsPro)

  const [offering, setOffering] = useState<PurchasesOffering | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PlanKey>('annual')
  const [busy, setBusy] = useState(false)

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

  // Savings %: annual price vs 12× the monthly price. Both come from the store.
  const savingsPct =
    annualPkg && monthlyPkg && monthlyPkg.product.price > 0
      ? Math.round((1 - annualPkg.product.price / (monthlyPkg.product.price * 12)) * 100)
      : null

  const trial = trialLabel(selectedPkg)

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

  const ctaLabel = trial ? 'Start Free Trial' : 'Unlock Tempo Pro'

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader
        title="Tempo Pro"
        size="sm"
        leading={<DismissButton kind="x" onPress={close} label="Close" />}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <FadeInView style={styles.hero} delay={20}>
          <View style={styles.heroBadge}>
            <TempoPulse size={26} />
          </View>
          <Text style={styles.heroTitle}>Unlock Tempo Pro</Text>
          <Text style={styles.heroSub}>
            Train smarter, stay consistent, and let Tempo optimize your workouts.
          </Text>
        </FadeInView>

        {/* Value props */}
        <View style={styles.valueCard}>
          {PAYWALL_POINTS.map((p, i) => (
            <FadeInView key={p.title} delay={80 + i * 50} style={styles.valueRow}>
              <View style={styles.valueIcon}>
                <Ionicons name={p.icon} size={18} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.valueTitle}>{p.title}</Text>
                <Text style={styles.valueBenefit}>{p.benefit}</Text>
              </View>
            </FadeInView>
          ))}
        </View>

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
                price={annualPkg.product.priceString}
                subline={
                  annualPkg.product.pricePerMonthString
                    ? `${annualPkg.product.pricePerMonthString}/mo · billed yearly`
                    : 'Billed yearly'
                }
                badge={savingsPct && savingsPct > 0 ? `SAVE ${savingsPct}%` : 'BEST VALUE'}
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

        {trial && (
          <Text style={styles.trialNote}>
            {trial}, then {selectedPkg?.product.priceString}
            {selected === 'annual' ? '/yr' : '/mo'}. Cancel anytime.
          </Text>
        )}
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
          <Text style={styles.footerLink} onPress={() => router.push('/legal')}>Terms</Text>
          <Text style={styles.footerDot}>·</Text>
          <Text style={styles.footerLink} onPress={() => router.push('/legal')}>Privacy</Text>
        </View>
        <Text style={styles.finePrint}>
          Payment is charged to your Apple ID. Subscriptions renew automatically unless cancelled at
          least 24 hours before the period ends. Manage or cancel in your App Store settings.
        </Text>
      </View>
    </SafeAreaView>
  )
}

function PlanOption({
  label, price, subline, badge, selected, onPress,
}: {
  label: string; price: string; subline: string; badge?: string; selected: boolean; onPress: () => void
}) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
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
        <Text style={styles.planPrice}>{price}</Text>
      </View>
    </PressableScale>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { padding: Spacing.containerPadding, paddingBottom: Spacing.lg, gap: Spacing.lg },

  hero: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm },
  heroBadge: {
    width: 64, height: 64, borderRadius: Radius.full, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs,
  },
  heroTitle: { fontFamily: C.fontDisplay, fontSize: 30, color: C.text, letterSpacing: -0.5, textAlign: 'center' },
  heroSub: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, textAlign: 'center', lineHeight: 22, paddingHorizontal: Spacing.md },

  valueCard: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md, ...CardShadow },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  valueIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  valueTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  valueBenefit: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18, marginTop: 1 },

  loadingBox: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.lg },
  loadingText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19 },

  plans: { gap: Spacing.sm },
  plan: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 2, borderColor: 'transparent',
  },
  planSelected: { borderColor: C.primary, backgroundColor: C.primarySoft },
  radio: {
    width: 22, height: 22, borderRadius: Radius.full, borderWidth: 2, borderColor: C.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: C.primary, backgroundColor: C.primary },
  planLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  planSubline: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, marginTop: 1 },
  planPrice: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.3 },
  planBadge: { backgroundColor: C.gold, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  planBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: '#1b1400', letterSpacing: 0.5 },

  trialNote: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary, textAlign: 'center' },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.sm, gap: Spacing.sm, borderTopWidth: 1, borderTopColor: C.outlineVariant },
  cta: { backgroundColor: C.primary, borderRadius: Radius.lg, paddingVertical: Spacing.md, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#fff', letterSpacing: 0.2 },
  footerLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  footerLink: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary },
  footerDot: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.outline },
  finePrint: { fontFamily: 'Inter_400Regular', fontSize: 10.5, color: C.outline, textAlign: 'center', lineHeight: 15 },
})
