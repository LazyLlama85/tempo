// Tempo — Pro gating UI primitives (the declarative layer over useProAccess).
//
//   <ProGate feature="advanced_analytics"><TheRealCharts/></ProGate>
//
// While Pro is dormant (proEnabled false) `locked` is false, so ProGate always
// renders its children — the free app is byte-for-byte unchanged until the remote
// flag flips. Once live, a locked feature renders a branded ProLockCard (or a custom
// `fallback`) that explains the benefit and routes to the paywall. Never crashes,
// never shows a half-broken feature.

import type { ReactNode } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { PressableScale } from '@/components/motion'
import { useProAccess } from '@/stores/entitlements'
import { proFeature, type ProFeatureId } from '@/lib/proFeatures'
import { track } from '@/lib/analytics'

/** Small gold "PRO" pill for labeling locked entry points inline. */
export function ProBadge({ style }: { style?: object }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={[styles.badge, style]}>
      <Text style={styles.badgeText}>PRO</Text>
    </View>
  )
}

/** The standard locked-feature upsell card. Tap → paywall (context = feature id). */
export function ProLockCard({ feature, compact }: { feature: ProFeatureId; compact?: boolean }) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const f = proFeature(feature)
  const open = () => {
    track('paywall_shown', { context: feature })
    router.push({ pathname: '/paywall', params: { context: feature } } as never)
  }
  return (
    <PressableScale
      style={[styles.lockCard, compact && styles.lockCardCompact]}
      onPress={open}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={`Unlock ${f.title} with Tempo Pro`}
    >
      <View style={styles.lockIcon}>
        <Ionicons name={f.icon} size={compact ? 18 : 22} color={C.primary} />
        <View style={styles.lockDot}>
          <Ionicons name="lock-closed" size={9} color="#fff" />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.lockTitleRow}>
          <Text style={styles.lockTitle}>{f.title}</Text>
          <ProBadge />
        </View>
        {!compact && <Text style={styles.lockBenefit}>{f.benefit}</Text>}
        <Text style={styles.lockCta}>Unlock with Pro →</Text>
      </View>
    </PressableScale>
  )
}

/**
 * Gate a block of UI. Renders `children` when the user has access (or Pro is
 * dormant); otherwise renders `fallback`, defaulting to the ProLockCard.
 */
export function ProGate({
  feature, children, fallback, compact,
}: {
  feature: ProFeatureId
  children: ReactNode
  fallback?: ReactNode
  compact?: boolean
}) {
  const { locked } = useProAccess()
  if (!locked) return <>{children}</>
  return <>{fallback ?? <ProLockCard feature={feature} compact={compact} />}</>
}

const makeStyles = (C: Palette) => StyleSheet.create({
  badge: { backgroundColor: C.gold, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: '#1b1400', letterSpacing: 0.6 },

  lockCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  lockCardCompact: { padding: Spacing.md },
  lockIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  lockDot: {
    position: 'absolute', bottom: -3, right: -3, width: 18, height: 18, borderRadius: Radius.full,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.surfaceContainerLow,
  },
  lockTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  lockTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  lockBenefit: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18, marginTop: 2 },
  lockCta: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary, marginTop: 6 },
})
