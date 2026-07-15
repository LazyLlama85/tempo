// Tempo — Body Intelligence (Muscle Map).
//
// A signature, Pro-gated feature: an interactive body map of training balance,
// recovery, and weak points, built on the real coarse muscle_group data (via
// lib/fitnessInsights.muscleIntelligence — no fabricated per-fine-muscle stats).
//
// Gating (dormant-safe): `useProGate().locked` is only true once Pro is LIVE and the
// user isn't subscribed — then free users get a premium *preview* (dimmed map +
// locked detail + a feature-specific upsell). While Pro is dormant, everyone sees
// the full feature, exactly like the rest of the app's Pro surfaces.

import { useMemo, useState } from 'react'
import { ScrollView, View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Spacing, Radius, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { ScreenHeader, DismissButton } from '@/components/brand'
import { FadeInView, PressableScale } from '@/components/motion'
import { EmptyState } from '@/components/EmptyState'
import { useAuthStore } from '@/stores/auth'
import { useProgressStats } from '@/hooks/useProgressStats'
import { muscleIntelligence, type MuscleStatus, type MuscleGroupIntel } from '@/lib/fitnessInsights'
import { MuscleMap, muscleStatusColor, type MuscleGroup, type BodyView } from '@/components/MuscleMap'
import { useProGate } from '@/stores/entitlements'
import { track } from '@/lib/analytics'

const GROUP_LABEL: Record<string, string> = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs', core: 'Core',
}
const STATUS_LABEL: Record<MuscleStatus, string> = {
  optimal: 'Optimal', attention: 'Needs attention', fatigued: 'Recovering', growing: 'Strong progress',
}
function lastTrainedLabel(hours: number | null): string {
  if (hours == null) return 'Not trained yet'
  if (hours < 24) return `${hours}h ago`
  const d = Math.round(hours / 24)
  return d === 1 ? 'Yesterday' : `${d} days ago`
}

export default function MuscleMapScreen() {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const { muscleTimeline, isLoading } = useProgressStats(userId)
  const { locked } = useProGate()

  const [view, setView] = useState<BodyView>('front')
  const [selected, setSelected] = useState<MuscleGroup | null>(null)

  const intel = useMemo(() => muscleIntelligence(muscleTimeline, new Date()), [muscleTimeline])
  const byGroup = useMemo(() => {
    const m: Partial<Record<MuscleGroup, MuscleGroupIntel>> = {}
    for (const g of intel.groups) m[g.group as MuscleGroup] = g
    return m
  }, [intel])
  const statusByGroup = useMemo(() => {
    const m: Partial<Record<MuscleGroup, MuscleStatus>> = {}
    for (const g of intel.groups) m[g.group as MuscleGroup] = g.status
    return m
  }, [intel])

  const openPaywall = () => {
    track('paywall_shown', { context: 'muscle_map' })
    router.push({ pathname: '/paywall', params: { context: 'muscle_map' } } as never)
  }

  const sel = selected ? byGroup[selected] : null

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScreenHeader title="Body Intelligence" size="sm" leading={<DismissButton kind="back" onPress={() => router.back()} label="Back" />} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {isLoading ? (
          <Text style={s.muted}>Reading your training…</Text>
        ) : !intel.hasData ? (
          <EmptyState
            kind="chart"
            title="Train to unlock your body map"
            body="Log a few sessions and Tempo maps your training balance, recovery, and weak points across every muscle group."
            actionLabel="Start a Quick Workout"
            onAction={() => router.push('/quick-workout')}
          />
        ) : (
          <>
            {/* Front / back toggle */}
            <View style={s.viewToggle}>
              {(['front', 'back'] as BodyView[]).map((v) => (
                <PressableScale key={v} style={[s.viewBtn, v === view && s.viewBtnOn]} scaleTo={0.95} onPress={() => setView(v)}>
                  <Text style={[s.viewBtnText, v === view && { color: C.onPrimary }]}>{v === 'front' ? 'Front' : 'Back'}</Text>
                </PressableScale>
              ))}
            </View>

            {/* The map */}
            <FadeInView key={view} style={s.mapCard}>
              <View style={s.heroGlow} pointerEvents="none" />
              <MuscleMap
                view={view}
                statusByGroup={statusByGroup}
                selected={selected}
                onSelect={(g) => setSelected(g === selected ? null : g)}
                dimmed={locked}
                size={210}
              />
              {locked && (
                <View style={s.mapLockPill}>
                  <Ionicons name="lock-closed" size={12} color={C.onPrimary} />
                  <Text style={s.mapLockPillText}>Pro preview</Text>
                </View>
              )}
              <View style={s.legend}>
                {(['optimal', 'growing', 'attention', 'fatigued'] as MuscleStatus[]).map((st) => (
                  <View key={st} style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: muscleStatusColor(C, st) }]} />
                    <Text style={s.legendText}>{STATUS_LABEL[st]}</Text>
                  </View>
                ))}
              </View>
            </FadeInView>

            {/* Tapped muscle detail */}
            {sel && (
              <FadeInView key={sel.group} style={s.card}>
                <View style={s.rowBetween}>
                  <Text style={s.detailTitle}>{GROUP_LABEL[sel.group] ?? sel.group}</Text>
                  <View style={[s.pill, { borderColor: muscleStatusColor(C, sel.status), backgroundColor: muscleStatusColor(C, sel.status) + '22' }]}>
                    <Text style={[s.pillText, { color: muscleStatusColor(C, sel.status) }]}>{STATUS_LABEL[sel.status]}</Text>
                  </View>
                </View>
                {locked ? (
                  <>
                    <Text style={s.muted}>Unlock to see your complete {GROUP_LABEL[sel.group]?.toLowerCase()} analysis.</Text>
                    <View style={s.lockedGrid}>
                      {['Training frequency', 'Weekly volume', 'Recovery', 'Strength trend'].map((l) => (
                        <View key={l} style={s.lockedRow}>
                          <Text style={s.lockedLabel}>{l}</Text>
                          <Ionicons name="lock-closed" size={14} color={C.outline} />
                        </View>
                      ))}
                    </View>
                    <PressableScale style={s.cta} scaleTo={0.97} onPress={openPaywall}>
                      <Ionicons name="sparkles" size={16} color={C.onPrimary} />
                      <Text style={s.ctaText}>Unlock Muscle Intelligence</Text>
                    </PressableScale>
                  </>
                ) : (
                  <>
                    <View style={s.statGrid}>
                      <Stat label="Frequency" value={`${sel.sessionsPerWeek}×/wk`} />
                      <Stat label="Weekly volume" value={`${sel.weeklySets} sets`} />
                      <Stat label="Recovery" value={`${sel.recoveryPct}%`} tint={muscleStatusColor(C, sel.status)} />
                      <Stat label="Last trained" value={lastTrainedLabel(sel.lastTrainedHours)} />
                      {sel.volumeTrendPct != null && (
                        <Stat label="Volume trend" value={`${sel.volumeTrendPct >= 0 ? '+' : ''}${sel.volumeTrendPct}%`} tint={sel.volumeTrendPct >= 0 ? C.readyHigh : C.textSecondary} />
                      )}
                    </View>
                    <View style={s.actionRow}>
                      <PressableScale style={s.actionBtn} scaleTo={0.97} onPress={() => router.push('/quick-workout')}>
                        <Ionicons name="flash" size={15} color={C.onPrimary} />
                        <Text style={s.actionText}>Train this</Text>
                      </PressableScale>
                      <PressableScale style={[s.actionBtn, s.actionBtnGhost]} scaleTo={0.97} onPress={() => router.push('/(tabs)/progress')}>
                        <Text style={[s.actionText, { color: C.primary }]}>See progress</Text>
                      </PressableScale>
                    </View>
                  </>
                )}
              </FadeInView>
            )}

            {/* Balance score */}
            <FadeInView style={s.card} delay={40}>
              <Text style={s.cardLabel}>MUSCLE BALANCE</Text>
              {locked ? (
                <LockedPanel
                  C={C} s={s}
                  headline="See how balanced your training is"
                  bullets={['Overall balance score', 'Weak-point detection', 'Volume per muscle group']}
                  onUnlock={openPaywall}
                />
              ) : (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                    <Text style={s.balanceScore}>{intel.overallBalance}</Text>
                    <Text style={s.balanceOutOf}>/ 100</Text>
                  </View>
                  <View style={{ gap: Spacing.xs, marginTop: 4 }}>
                    {intel.groups.map((g) => (
                      <View key={g.group} style={s.balanceRow}>
                        <Text style={s.balanceGroup}>{GROUP_LABEL[g.group] ?? g.group}</Text>
                        <View style={s.balanceTrack}>
                          <View style={[s.balanceFill, { width: `${Math.max(3, g.balance)}%` as `${number}%`, backgroundColor: muscleStatusColor(C, g.status) }]} />
                        </View>
                        <Text style={s.balanceVal}>{g.balance}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </FadeInView>

            {/* Insights */}
            <FadeInView style={s.card} delay={80}>
              <Text style={s.cardLabel}>MUSCLE INSIGHTS</Text>
              {locked ? (
                <LockedPanel
                  C={C} s={s}
                  headline="Your body has a story. Read it."
                  bullets={['Weak-point detection', 'Recovery status by muscle', 'Growth & training-gap alerts']}
                  onUnlock={openPaywall}
                />
              ) : intel.insights.length > 0 ? (
                intel.insights.map((ins, i) => (
                  <View key={i} style={s.insightRow}>
                    <Ionicons
                      name={ins.kind === 'growth' ? 'trending-up' : ins.kind === 'recovery' ? 'bed-outline' : ins.kind === 'weak' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                      size={16}
                      color={ins.kind === 'growth' ? C.eventPersonal : ins.kind === 'recovery' ? C.readyLow : ins.kind === 'weak' ? C.readyMed : C.readyHigh}
                    />
                    <Text style={s.insightText}>{ins.text}</Text>
                  </View>
                ))
              ) : (
                <Text style={s.muted}>Keep training — a few more sessions and Tempo will surface balance & recovery insights here.</Text>
              )}
            </FadeInView>

            <Text style={s.footNote}>Estimated from your logged sets across Tempo's six muscle groups.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  const s = useThemedStyles(makeStyles)
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  )
}

function LockedPanel({
  C, s, headline, bullets, onUnlock,
}: { C: Palette; s: ReturnType<typeof makeStyles>; headline: string; bullets: string[]; onUnlock: () => void }) {
  return (
    <View style={{ gap: Spacing.sm }}>
      <Text style={s.lockedHeadline}>{headline}</Text>
      {bullets.map((b) => (
        <View key={b} style={s.checkRow}>
          <Ionicons name="checkmark-circle" size={16} color={C.primary} />
          <Text style={s.checkText}>{b}</Text>
        </View>
      ))}
      <PressableScale style={s.cta} scaleTo={0.97} onPress={onUnlock}>
        <Ionicons name="sparkles" size={16} color={C.onPrimary} />
        <Text style={s.ctaText}>Unlock Muscle Intelligence</Text>
      </PressableScale>
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { padding: Spacing.containerPadding, gap: Spacing.lg, paddingBottom: 120 },
  muted: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, lineHeight: 19 },
  footNote: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: C.outline, textAlign: 'center' },

  viewToggle: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: 4, gap: 2, alignSelf: 'center' },
  viewBtn: { paddingHorizontal: Spacing.xl, paddingVertical: 8, borderRadius: Radius.md },
  viewBtnOn: { backgroundColor: C.primary },
  viewBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },

  mapCard: { backgroundColor: C.surfaceContainer, borderRadius: Radius.card, padding: Spacing.md, alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: C.glassBorder, overflow: 'hidden', ...Elevation.e1 },
  heroGlow: { position: 'absolute', top: -40, alignSelf: 'center', width: 260, height: 260, borderRadius: 130, backgroundColor: C.primaryGlow },
  mapLockPill: { position: 'absolute', top: Spacing.md, right: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primary, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  mapLockPillText: { fontFamily: 'Inter_700Bold', fontSize: 10.5, color: C.onPrimary, letterSpacing: 0.3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontFamily: 'Inter_500Medium', fontSize: 11.5, color: C.textSecondary },

  card: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.card, padding: Spacing.lg, gap: Spacing.md, ...Elevation.e1 },
  cardLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailTitle: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, borderWidth: 1 },
  pillText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.3 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  stat: { flexGrow: 1, flexBasis: '30%', backgroundColor: C.surfaceContainer, borderRadius: Radius.md, padding: Spacing.sm, gap: 2 },
  statValue: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.4 },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary },
  actionRow: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: Radius.lg, backgroundColor: C.primary },
  actionBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.primaryLine },
  actionText: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.onPrimary },

  balanceScore: { fontFamily: C.fontDisplay, fontSize: 44, color: C.text, letterSpacing: -1.5 },
  balanceOutOf: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.textSecondary },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  balanceGroup: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.text, width: 74 },
  balanceTrack: { flex: 1, height: 8, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.pill, overflow: 'hidden' },
  balanceFill: { height: 8, borderRadius: Radius.pill },
  balanceVal: { fontFamily: C.fontDisplay, fontSize: 13, color: C.textSecondary, width: 26, textAlign: 'right' },

  insightRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  insightText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13.5, color: C.text, lineHeight: 19 },

  lockedHeadline: { fontFamily: C.fontDisplay, fontSize: 17, color: C.text, letterSpacing: -0.2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkText: { fontFamily: 'Inter_500Medium', fontSize: 13.5, color: C.textSecondary },
  lockedGrid: { gap: Spacing.xs },
  lockedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.outlineVariant },
  lockedLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: Radius.lg, backgroundColor: C.primary, marginTop: 2, ...Elevation.e2 },
  ctaText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
})
