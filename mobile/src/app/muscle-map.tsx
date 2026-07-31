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
import { ScreenHeader, DismissButton, PulseLoader } from '@/components/brand'
import { FadeInView, PressableScale } from '@/components/motion'
import { EmptyState } from '@/components/EmptyState'
import { useAuthStore } from '@/stores/auth'
import { useProgressStats } from '@/hooks/useProgressStats'
import { muscleIntelligence, muscleRank, fineMuscleIntelligence, MUSCLE_TIERS, MUSCLE_TIER_LABEL, type MuscleStatus, type MuscleGroupIntel, type MuscleTier, type BodyMuscle } from '@/lib/fitnessInsights'
import { MuscleMap, muscleStatusColor, muscleTierColor, type MuscleGroup, type BodyView, type MapMode } from '@/components/MuscleMap'
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
  const { muscleTimeline, muscleFineTimeline, isLoading } = useProgressStats(userId)
  const { locked } = useProGate()

  const [view, setView] = useState<BodyView>('front')
  const [selected, setSelected] = useState<MuscleGroup | null>(null)   // coarse (heatmap/rank)
  const [selMuscle, setSelMuscle] = useState<BodyMuscle | null>(null)  // fine (status mode)

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

  const [mode, setMode] = useState<MapMode>('status')
  const [heatRange, setHeatRange] = useState<7 | 30 | 90>(30)

  // Heatmap: training stimulus per group over the window, normalized 0–1.
  const heatByGroup = useMemo(() => {
    const now = Date.now(); const win = heatRange * 86_400_000
    const counts: Partial<Record<MuscleGroup, number>> = {}
    for (const s of muscleTimeline) {
      if (!s.group || !s.at) continue
      const g = s.group.toLowerCase() as MuscleGroup
      const t = new Date(s.at).getTime()
      if (Number.isFinite(t) && now - t <= win) counts[g] = (counts[g] ?? 0) + 1
    }
    const max = Math.max(1, ...Object.values(counts) as number[])
    const out: Partial<Record<MuscleGroup, number>> = {}
    for (const g of Object.keys(counts) as MuscleGroup[]) out[g] = (counts[g] ?? 0) / max
    return out
  }, [muscleTimeline, heatRange])

  // Rank: per-muscle training tier (most→least trained) for the Progress view.
  const rank = useMemo(() => muscleRank(muscleTimeline), [muscleTimeline])
  const rankByGroup = useMemo(() => {
    const m: Partial<Record<MuscleGroup, MuscleTier>> = {}
    for (const g of rank.groups) m[g.group as MuscleGroup] = g.tier
    return m
  }, [rank])

  // Per-INDIVIDUAL-muscle recovery/status (biceps vs triceps, quads vs hamstrings…) —
  // powers the per-muscle body shading + the "recovery by muscle" readout that
  // replaced the old overlapping recovery bubbles.
  const fineIntel = useMemo(() => fineMuscleIntelligence(muscleFineTimeline, new Date()), [muscleFineTimeline])
  const statusBySlug = useMemo(() => {
    const m: Partial<Record<string, MuscleStatus>> = {}
    for (const fm of fineIntel.muscles) m[fm.muscle] = fm.status
    return m
  }, [fineIntel])
  const fineSel = selMuscle ? fineIntel.muscles.find((m) => m.muscle === selMuscle) ?? null : null

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
          <PulseLoader caption="Reading your training…" />
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
            {/* Toggles: front/back + status/heatmap */}
            <View style={s.toggleRow}>
              <View style={s.viewToggle}>
                {(['front', 'back'] as BodyView[]).map((v) => (
                  <PressableScale
                    key={v}
                    style={[s.viewBtn, v === view && s.viewBtnOn]}
                    scaleTo={0.95}
                    onPress={() => { setView(v); setSelected(null); setSelMuscle(null) }}
                    accessibilityState={{ selected: v === view }}
                    accessibilityLabel={v === 'front' ? 'Front view' : 'Back view'}
                  >
                    <Text style={[s.viewBtnText, v === view && { color: C.onPrimary }]}>{v === 'front' ? 'Front' : 'Back'}</Text>
                  </PressableScale>
                ))}
              </View>
              <View style={s.viewToggle}>
                {(['status', 'heatmap', 'rank'] as MapMode[]).map((m) => (
                  <PressableScale
                    key={m}
                    style={[s.viewBtn, m === mode && s.viewBtnOn]}
                    scaleTo={0.95}
                    onPress={() => { setMode(m); setSelected(null); setSelMuscle(null) }}
                    accessibilityState={{ selected: m === mode }}
                    accessibilityLabel={m === 'status' ? 'Status view' : m === 'heatmap' ? 'Heatmap view' : 'Rank view'}
                  >
                    <Text style={[s.viewBtnText, m === mode && { color: C.onPrimary }]}>{m === 'status' ? 'Status' : m === 'heatmap' ? 'Heatmap' : 'Rank'}</Text>
                  </PressableScale>
                ))}
              </View>
            </View>

            {mode === 'heatmap' && (
              <View style={s.rangeRow}>
                {([7, 30, 90] as const).map((r) => (
                  <PressableScale
                    key={r}
                    style={[s.rangeChip, r === heatRange && s.rangeChipOn]}
                    scaleTo={0.94}
                    onPress={() => setHeatRange(r)}
                    accessibilityState={{ selected: r === heatRange }}
                    accessibilityLabel={`Last ${r} days`}
                  >
                    <Text style={[s.rangeChipText, r === heatRange && { color: C.onPrimary }]}>Last {r} days</Text>
                  </PressableScale>
                ))}
              </View>
            )}

            {/* The map */}
            <FadeInView key={`${view}-${mode}`} style={s.mapCard}>
              <View style={s.heroGlow} pointerEvents="none" />
              <View style={s.mapFigureWrap}>
                {/* `locked` makes MuscleMap render its SAMPLE body under a blur —
                    the real statusByGroup/BySlug never reaches the figure. */}
                <MuscleMap
                  view={view}
                  statusByGroup={statusByGroup}
                  statusBySlug={statusBySlug}
                  heatByGroup={heatByGroup}
                  rankByGroup={rankByGroup}
                  mode={mode}
                  selected={selected}
                  onSelect={(g) => setSelected(g === selected ? null : g)}
                  selectedSlug={selMuscle}
                  onSelectSlug={(sl) => { if (statusBySlug[sl]) setSelMuscle((prev) => (prev === sl ? null : (sl as BodyMuscle))) }}
                  locked={locked}
                  size={210}
                />
              </View>
              {mode === 'status' ? (
                <View style={s.legend}>
                  {(['optimal', 'growing', 'attention', 'fatigued'] as MuscleStatus[]).map((st) => (
                    <View key={st} style={s.legendItem}>
                      <View style={[s.legendDot, { backgroundColor: muscleStatusColor(C, st) }]} />
                      <Text style={s.legendText}>{STATUS_LABEL[st]}</Text>
                    </View>
                  ))}
                </View>
              ) : mode === 'heatmap' ? (
                <View style={s.legend}>
                  <Text style={s.legendText}>Less trained</Text>
                  <View style={[s.legendDot, { backgroundColor: C.primary, opacity: 0.25 }]} />
                  <View style={[s.legendDot, { backgroundColor: C.primary, opacity: 0.6 }]} />
                  <View style={[s.legendDot, { backgroundColor: C.primary }]} />
                  <Text style={s.legendText}>More</Text>
                </View>
              ) : (
                <View style={s.legend}>
                  {MUSCLE_TIERS.map((t) => (
                    <View key={t} style={s.legendItem}>
                      <View style={[s.legendDot, { backgroundColor: muscleTierColor(C, t) }]} />
                      <Text style={s.legendText}>{MUSCLE_TIER_LABEL[t]}</Text>
                    </View>
                  ))}
                </View>
              )}
              {/* Locked-gated: this line names the user's real most/least-trained
                  groups — the same insight the blurred figure is hiding. */}
              {mode === 'rank' && !locked && rank.mostTrained && (
                <Text style={s.footNote}>Most trained: {GROUP_LABEL[rank.mostTrained]} · Least: {GROUP_LABEL[rank.leastTrained ?? '']}</Text>
              )}

              {/* The unlock CTA covers the WHOLE CARD, not just the figure. Scoped
                  to the figure it rendered as a hard-edged rectangle floating inside
                  a lighter card — it read as a broken panel rather than a locked
                  one — and its copy was crammed into the figure's 210pt width, so
                  "Your body map is Pro" wrapped mid-phrase (worse on a 390pt phone).
                  Covering the card also hides the colour legend, which otherwise sat
                  below explaining a key for data the user can't see. MuscleMap still
                  blurs the figure itself for the small Progress teaser. */}
              {locked && (
                <PressableScale
                  style={[StyleSheet.absoluteFill, s.mapLockScrim]}
                  scaleTo={0.98}
                  onPress={openPaywall}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock your body map with Tempo Pro"
                >
                  <View style={s.mapLockIcon}>
                    <Ionicons name="lock-closed" size={20} color={C.onPrimary} />
                  </View>
                  <Text style={s.mapLockTitle}>Your body map is Pro</Text>
                  <Text style={s.mapLockBody}>This is sample data. Unlock to see your own recovery, balance and weak points.</Text>
                  <View style={s.mapLockCta}>
                    <Text style={s.mapLockCtaText}>Unlock with Pro</Text>
                    <Ionicons name="arrow-forward" size={15} color={C.onPrimary} />
                  </View>
                </PressableScale>
              )}
            </FadeInView>

            {/* Per-muscle detail (status mode — biceps, quads, etc. individually) */}
            {mode === 'status' && !locked && fineSel && (
              <FadeInView key={fineSel.muscle} style={s.card}>
                <View style={s.rowBetween}>
                  <Text style={s.detailTitle}>{fineSel.label}</Text>
                  <View style={[s.pill, { borderColor: muscleStatusColor(C, fineSel.status), backgroundColor: muscleStatusColor(C, fineSel.status) + '22' }]}>
                    <Text style={[s.pillText, { color: muscleStatusColor(C, fineSel.status) }]}>{STATUS_LABEL[fineSel.status]}</Text>
                  </View>
                </View>
                <View style={s.statGrid}>
                  <Stat label="Recovery" value={`${fineSel.recoveryPct}%`} tint={muscleStatusColor(C, fineSel.status)} />
                  <Stat label="Last trained" value={lastTrainedLabel(fineSel.lastTrainedHours)} />
                  <Stat label="Sets this week" value={`${fineSel.weeklySets}`} />
                </View>
                <View style={s.actionRow}>
                  <PressableScale style={s.actionBtn} scaleTo={0.97} onPress={() => router.push('/quick-workout')}>
                    <Ionicons name="flash" size={15} color={C.onPrimary} />
                    <Text style={s.actionText}>Train this</Text>
                  </PressableScale>
                  <PressableScale
                    style={[s.actionBtn, s.actionBtnGhost]}
                    scaleTo={0.97}
                    onPress={() => router.push({ pathname: '/muscle-history', params: { muscleSlug: fineSel.muscle, title: fineSel.label } } as never)}
                  >
                    <Text style={[s.actionText, { color: C.primary }]}>See history</Text>
                  </PressableScale>
                </View>
              </FadeInView>
            )}

            {/* Recovery-by-muscle readout — each muscle's % next to it, no overlap
                (replaces the old floating recovery bubbles that piled up on the torso). */}
            {mode === 'status' && !locked && fineIntel.hasData && (
              <FadeInView style={s.card} delay={20}>
                <Text style={s.cardLabel}>RECOVERY BY MUSCLE</Text>
                <View style={s.readoutGrid}>
                  {fineIntel.muscles.map((m) => {
                    const on = selMuscle === m.muscle
                    const col = muscleStatusColor(C, m.status)
                    return (
                      <PressableScale
                        key={m.muscle}
                        style={[s.readoutRow, on && { borderColor: col, backgroundColor: col + '18' }]}
                        scaleTo={0.97}
                        onPress={() => setSelMuscle((prev) => (prev === m.muscle ? null : m.muscle))}
                      >
                        <View style={[s.readoutDot, { backgroundColor: col }]} />
                        <Text style={s.readoutLabel} numberOfLines={1}>{m.label}</Text>
                        <Text style={[s.readoutPct, { color: col }]}>{m.recoveryPct}%</Text>
                      </PressableScale>
                    )
                  })}
                </View>
                <Text style={s.footNote}>Recovery since each muscle was last trained. Tap one for detail.</Text>
              </FadeInView>
            )}

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
                      <PressableScale
                        style={[s.actionBtn, s.actionBtnGhost]}
                        scaleTo={0.97}
                        onPress={() => router.push({ pathname: '/muscle-history', params: { muscleGroup: sel.group, title: GROUP_LABEL[sel.group] ?? sel.group } } as never)}
                      >
                        <Text style={[s.actionText, { color: C.primary }]}>See history</Text>
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

  toggleRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: Spacing.sm },
  viewToggle: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: 4, gap: 2 },
  viewBtn: { paddingHorizontal: Spacing.lg, paddingVertical: 8, borderRadius: Radius.md },
  viewBtnOn: { backgroundColor: C.primary },
  viewBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },
  rangeRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs },
  rangeChip: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.pill, backgroundColor: C.surfaceContainerLow },
  rangeChipOn: { backgroundColor: C.primary },
  rangeChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary },

  mapCard: { backgroundColor: C.surfaceContainer, borderRadius: Radius.card, padding: Spacing.md, alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: C.glassBorder, overflow: 'hidden', ...Elevation.e1 },
  heroGlow: { position: 'absolute', top: -40, alignSelf: 'center', width: 260, height: 260, borderRadius: 130, backgroundColor: C.primaryGlow },

  // Locked map: the figure and its blur/scrim overlay share this wrapper so the
  // overlay covers the body exactly (not the card's legend + toggles below it).
  mapFigureWrap: { position: 'relative' },
  // Fills the whole map card. Opaque enough that the sample figure reads as a
  // hint behind the panel rather than as content, and so the copy on top keeps
  // its contrast in both themes.
  mapLockScrim: {
    alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: Spacing.lg,
    backgroundColor: C.scrimHeavy,
    borderRadius: Radius.card,
  },
  mapLockIcon: {
    width: 40, height: 40, borderRadius: Radius.full, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  mapLockTitle: { fontFamily: C.fontDisplay, fontSize: 17, color: C.text, letterSpacing: -0.2, textAlign: 'center' },
  mapLockBody: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 17, textAlign: 'center' },
  mapLockCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
    backgroundColor: C.primary, borderRadius: Radius.pill, paddingHorizontal: 16, paddingVertical: 9,
  },
  mapLockCtaText: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.onPrimary },
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
  readoutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  readoutRow: { flexGrow: 1, flexBasis: '46%', flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: 8, paddingHorizontal: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: C.outlineVariant, backgroundColor: C.surfaceContainer },
  readoutDot: { width: 8, height: 8, borderRadius: 4 },
  readoutLabel: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.text },
  readoutPct: { fontFamily: C.fontDisplay, fontSize: 14, letterSpacing: -0.3 },
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
