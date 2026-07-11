import { useEffect, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRefreshOnFocus } from '@/hooks/useRefreshOnFocus'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'expo-router'
import { useProgressStats, type ChartPeriod } from '@/hooks/useProgressStats'
import { ACHIEVEMENTS, type AchievementStats } from '@/lib/achievements'
import { LoadingCard } from '@/components/LoadingCard'
import { ScreenHeader, HeaderActions } from '@/components/brand'
import { ErrorBanner } from '@/components/ErrorBanner'
import { FadeInView, PopIn, PressableScale, ScreenTransition } from '@/components/motion'
import { SvgProgressRing } from '@/components/SvgProgressRing'
import { SvgLineChart } from '@/components/SvgLineChart'
import { SvgGrowBar } from '@/components/SvgGrowBar'
import { CountUp, ConfettiBurst } from '@/components/celebration'
import { EmptyState } from '@/components/EmptyState'
import { supabase } from '@/lib/supabase'
import { buildWrappedCards, type WrappedCard } from '@/lib/wrapped'
import { ShareCardSheet } from '@/components/ShareCardSheet'
import { Avatar } from '@/components/Avatar'
import { useWeightUnit, unitLabel, displayWeight, displayVolume, formatWeightDelta } from '@/lib/units'
import { fetchMeasurements, computeWeightTrend } from '@/lib/bodyMeasurements'
import type { BodyMeasurement } from '@/types'


const TIER_COLOR: Record<string, string> = {
  bronze: '#B45309',
  silver: '#64748B',
  gold: '#B8860B',
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return '—'
  }
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ProgressScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const [period, setPeriod] = useState<ChartPeriod>('M')
  const unit = useWeightUnit()
  const { stats, isLoading, isError, refetch } = useProgressStats(userId, period)
  const [shareOpen, setShareOpen] = useState(false)
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([])

  const { data: cards = [] } = useQuery<WrappedCard[]>({
    queryKey: ['wrapped_cards', userId],
    queryFn: () => buildWrappedCards(supabase, userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  // Fresh numbers every time the tab comes back into focus — completing a
  // workout must show up here immediately, not after an app restart.
  useRefreshOnFocus(['progress_workouts'], ['progress_set_logs'], ['wrapped_cards'])

  // Weight trend: the math (computeWeightTrend/rollingAverage) already existed
  // in lib/bodyMeasurements — it was just never charted, only shown as text
  // numbers on Profile. Same 120-day fetch Profile uses.
  useEffect(() => {
    if (userId) fetchMeasurements(supabase, userId, 120).then(setMeasurements).catch(() => {})
  }, [userId])
  const weightTrend = computeWeightTrend(measurements)
  const weightChartPoints = measurements
    .filter((m) => m.weight_lbs != null)
    .map((m) => ({ label: m.measured_at, value: displayWeight(m.weight_lbs as number, unit) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const consistency_pct = stats?.consistency_pct ?? 0
  const streak = stats?.streak ?? 0
  const prs = stats?.prs ?? []
  const chartVolumes = stats?.chartVolumes ?? []
  const chartLabels = stats?.chartLabels ?? []
  const deltaStr = stats?.deltaStr ?? '— vs last mo'

  const achStats: AchievementStats = {
    totalWorkouts: stats?.totalWorkouts ?? 0,
    streak: stats?.streak ?? 0,
    totalVolumeNum: stats?.totalVolumeNum ?? 0,
    benchMax: stats?.benchMax ?? 0,
  }

  // One-time celebration when an achievement newly unlocks — compare against
  // what this device has already seen. The first-ever visit only records the
  // baseline, so nobody gets confetti for ancient history.
  const [unlockedCelebration, setUnlockedCelebration] = useState<string | null>(null)
  useEffect(() => {
    if (isLoading || achStats.totalWorkouts === 0) return
    const unlocked = ACHIEVEMENTS.filter(a => a.isUnlocked(achStats)).map(a => a.key)
    try {
      const store = (globalThis as { localStorage?: Storage }).localStorage
      const raw = store?.getItem('tempo.seenAchievements') ?? null
      if (raw !== null) {
        const seen = new Set<string>(JSON.parse(raw) as string[])
        const fresh = unlocked.find(k => !seen.has(k))
        if (fresh) {
          const def = ACHIEVEMENTS.find(a => a.key === fresh)
          setUnlockedCelebration(def?.label ?? fresh)
        }
      }
      store?.setItem('tempo.seenAchievements', JSON.stringify(unlocked))
    } catch { /* celebration is best-effort */ }
    // achStats is rebuilt per render; its primitive fields are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, achStats.totalWorkouts, achStats.streak, achStats.totalVolumeNum, achStats.benchMax])

  useEffect(() => {
    if (!unlockedCelebration) return
    const t = setTimeout(() => setUnlockedCelebration(null), 6000)
    return () => clearTimeout(t)
  }, [unlockedCelebration])

  // Roadmap: the milestone you're closest to unlocking — "where you're headed".
  const nextMilestone = (() => {
    const locked = ACHIEVEMENTS.filter(a => !a.isUnlocked(achStats))
    if (!locked.length) return null
    const scored = locked.map(a => {
      const p = a.progress(achStats)
      return { def: a, current: p.current, target: p.target, ratio: p.target > 0 ? p.current / p.target : 0 }
    })
    scored.sort((x, y) => y.ratio - x.ratio)
    return scored[0]
  })()

  const maxChartVol = Math.max(...chartVolumes, 1)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
      {/* Header */}
      <ScreenHeader
        right={
          <HeaderActions>
            {cards.length > 0 && (
              <TouchableOpacity onPress={() => setShareOpen(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Share a progress card"><Ionicons name="share-outline" size={22} color={C.text} /></TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open your profile"><Avatar size={32} iconSize={16} /></TouchableOpacity>
          </HeaderActions>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={styles.eyebrow}>YOUR PERFORMANCE</Text>
          <Text style={styles.title}>Progress Overview</Text>
        </View>

        {isLoading ? (
          <>
            <LoadingCard />
            <LoadingCard />
            <LoadingCard />
          </>
        ) : isError ? (
          <ErrorBanner message="Failed to load your progress." onRetry={refetch} />
        ) : stats.totalWorkouts === 0 ? (
          <EmptyState
            kind="chart"
            title="Your story starts with one session"
            body="Complete your first workout and this page comes alive — consistency ring, streak, records, and your volume trend."
            actionLabel="Start a Quick Workout"
            onAction={() => router.push('/quick-workout')}
          />
        ) : (
          <>
            {/* Consistency ring — sweeps to its score every time you land here */}
            <FadeInView style={styles.ringCard} delay={40}>
              <Text style={styles.ringLabel}>CONSISTENCY SCORE</Text>
              <View style={styles.ringWrap}>
                <SvgProgressRing value={consistency_pct} size={140} stroke={14} gradientFrom={C.primary} gradientTo={C.success}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                    <CountUp value={consistency_pct} delay={250} style={styles.ringPercent} />
                    <Text style={[styles.ringPercent, { fontSize: 20 }]}>%</Text>
                  </View>
                  <Text style={styles.ringSubLabel}>{consistency_pct >= 80 ? 'TARGET MET' : 'KEEP GOING'}</Text>
                </SvgProgressRing>
              </View>
              <Text style={styles.ringCaption}>
                {consistency_pct > 0
                  ? `${consistency_pct}% completion rate in the last 30 days.`
                  : 'Complete your first workout to start tracking.'}
              </Text>
            </FadeInView>

            {/* Streak card */}
            <FadeInView style={styles.streakCard} delay={120}>
              <View style={styles.streakRow}>
                <Ionicons name="flame" size={22} color="rgba(255,255,255,0.8)" />
                <Text style={styles.streakTag}>CURRENT STREAK</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <CountUp value={streak} delay={300} duration={700} style={styles.streakNum} />
                <Text style={styles.streakUnit}>{streak === 1 ? 'Session' : 'Sessions'}</Text>
              </View>
              <Text style={styles.streakCaption}>
                {streak > 0
                  ? `${streak} in a row with no misses — rest days don't break it.`
                  : 'Complete your next scheduled workout to start your streak.'}
              </Text>
            </FadeInView>

            {/* Next milestone (roadmap) */}
            {nextMilestone && (
              <View style={styles.statCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.statLabel}>NEXT MILESTONE</Text>
                  <Ionicons name={nextMilestone.def.icon as any} size={16} color={C.primary} />
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.milestoneName}>{nextMilestone.def.label}</Text>
                  <Text style={styles.milestoneRemain}>
                    {Math.max(0, Math.round(nextMilestone.target - nextMilestone.current)).toLocaleString()} to go
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.round(nextMilestone.ratio * 100)}%` as `${number}%` }]} />
                </View>
                <Text style={styles.milestoneCaption}>
                  {nextMilestone.def.description} · {Math.round(nextMilestone.current).toLocaleString()}/{nextMilestone.target.toLocaleString()}
                </Text>
              </View>
            )}

            {/* Completion rate */}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>COMPLETION RATE</Text>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>{consistency_pct}%</Text>
                <Text style={styles.statDelta}>{deltaStr}</Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${consistency_pct}%` as `${number}%` }]} />
              </View>
            </View>

            {/* Volume + period chart */}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>VOLUME LIFTED</Text>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>
                  {displayVolume(stats?.periodVolumeNum ?? 0, unit)}{' '}
                  <Text style={styles.statUnit}>{unitLabel(unit)}</Text>
                </Text>
                <View style={styles.periodToggle}>
                  {(['W', 'M', '6M'] as ChartPeriod[]).map((p) => (
                    <PressableScale
                      key={p}
                      style={[styles.periodBtn, p === period && styles.periodBtnActive]}
                      onPress={() => setPeriod(p)}
                      scaleTo={0.9}
                    >
                      <Text style={[styles.periodText, p === period && styles.periodTextActive]}>{p}</Text>
                    </PressableScale>
                  ))}
                </View>
              </View>

              <View style={styles.weekBarsContainer}>
                {chartVolumes.map((vol, i) => {
                  const barH = vol > 0 ? Math.max(4, Math.round((vol / maxChartVol) * 44)) : 0
                  const isCurrent = i === chartVolumes.length - 1
                  return (
                    <View key={`${period}-${i}`} style={styles.weekBarCol}>
                      <View style={{ width: '100%', justifyContent: 'flex-end', opacity: barH > 0 ? 1 : 0.4 }}>
                        <SvgGrowBar
                          height={barH > 0 ? barH : 2}
                          delay={i * 50}
                          color={barH > 0 && isCurrent ? C.primary : C.surfaceContainerHigh}
                        />
                      </View>
                      <Text style={[styles.dayDotLabel, isCurrent && styles.dayDotLabelActive]}>
                        {chartLabels[i]}
                      </Text>
                    </View>
                  )
                })}
              </View>
              {(() => {
                // A small, data-driven insight — no invented claims, just the real
                // delta between the current bucket and the one before it.
                const n = chartVolumes.length
                if (n < 2) return null
                const cur = chartVolumes[n - 1]
                const prev = chartVolumes[n - 2]
                if (prev <= 0) return null
                const pct = Math.round(((cur - prev) / prev) * 100)
                if (pct === 0) return null
                const noun = period === 'W' ? 'last week' : period === 'M' ? 'last month' : 'the prior period'
                return (
                  <View style={styles.insightRow}>
                    <Ionicons name={pct > 0 ? 'trending-up' : 'trending-down'} size={14} color={pct > 0 ? C.success : C.textSecondary} />
                    <Text style={styles.insightText}>
                      {pct > 0 ? '+' : ''}{pct}% volume vs {noun}
                    </Text>
                  </View>
                )
              })()}
            </View>

            {/* Weight trend — the math already existed (bodyMeasurements.ts), it just
                had no chart anywhere, only text numbers on Profile. */}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>WEIGHT TREND</Text>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>
                  {weightTrend.currentAvg != null ? displayWeight(weightTrend.currentAvg, unit) : '—'}{' '}
                  <Text style={styles.statUnit}>{unitLabel(unit)}</Text>
                </Text>
                <Text style={styles.statDelta}>
                  {weightTrend.lbsPerWeek != null ? `${formatWeightDelta(weightTrend.lbsPerWeek, unit)}/wk` : '—'}
                </Text>
              </View>
              <SvgLineChart
                points={weightChartPoints}
                color={C.primary}
                emptyText="Log a few weigh-ins on Profile to see your trend here."
              />
            </View>

            {/* Personal records */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Personal Records</Text>
                <TouchableOpacity onPress={() => router.push('/pr-browser' as any)} hitSlop={8}>
                  <Text style={styles.sectionAction}>Search all →</Text>
                </TouchableOpacity>
              </View>
              {prs.length > 0 ? prs.map((pr) => (
                <PressableScale
                  key={pr.name}
                  style={styles.recordRow}
                  onPress={() => router.push({ pathname: '/exercise-progress', params: { exerciseId: pr.id, name: pr.name } } as any)}
                  scaleTo={0.98}
                >
                  <View style={styles.recordIcon}>
                    <Ionicons name="barbell-outline" size={20} color={C.primary} />
                  </View>
                  <View style={styles.recordInfo}>
                    <Text style={styles.recordName}>{pr.name}</Text>
                    <Text style={styles.recordMeta}>{fmtDate(pr.achievedAt)} · tap for trend</Text>
                  </View>
                  <View style={styles.recordRight}>
                    <Text style={styles.recordValue}>
                      {displayWeight(pr.maxWeight, unit)} <Text style={styles.recordUnit}>{unitLabel(unit)}</Text>
                    </Text>
                  </View>
                </PressableScale>
              )) : (
                <View style={styles.recordRow}>
                  <Text style={styles.recordMeta}>No weight PRs logged yet.</Text>
                </View>
              )}
            </View>

            {/* Achievements */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Achievements</Text>
                <Text style={styles.achMeta}>
                  {ACHIEVEMENTS.filter(a => a.isUnlocked(achStats)).length} of {ACHIEVEMENTS.length}
                </Text>
              </View>
              <View style={styles.achievementsRow}>
                {ACHIEVEMENTS.map((a) => {
                  const isUnlocked = a.isUnlocked(achStats)
                  const prog = a.progress(achStats)
                  const tint = isUnlocked ? TIER_COLOR[a.tier] : C.outline
                  return (
                    <View
                      key={a.key}
                      style={[styles.achievementBadge, !isUnlocked && styles.achievementBadgeLocked]}
                    >
                      <View style={[styles.achBadgeIcon, { backgroundColor: isUnlocked ? tint + '22' : C.surfaceContainerHigh }]}>
                        <Ionicons name={a.icon as any} size={24} color={tint} />
                        {!isUnlocked && (
                          <View style={styles.achLockDot}><Ionicons name="lock-closed" size={9} color={C.outline} /></View>
                        )}
                      </View>
                      <Text style={[styles.achievementLabel, !isUnlocked && styles.achievementLabelLocked]} numberOfLines={1}>
                        {a.label}
                      </Text>
                      {isUnlocked ? (
                        <Text style={styles.achDesc} numberOfLines={2}>{a.description}</Text>
                      ) : prog.target > 1 ? (
                        <Text style={styles.achProg}>{Math.round(prog.current).toLocaleString()}/{prog.target.toLocaleString()}</Text>
                      ) : (
                        <Text style={styles.achDesc} numberOfLines={2}>{a.description}</Text>
                      )}
                    </View>
                  )
                })}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Achievement unlocked — confetti + a gold toast, once per unlock */}
      {unlockedCelebration && (
        <>
          <ConfettiBurst />
          <PopIn style={styles.unlockToast}>
            <View style={styles.unlockIcon}>
              <Ionicons name="trophy" size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.unlockLabel}>ACHIEVEMENT UNLOCKED</Text>
              <Text style={styles.unlockTitle} numberOfLines={1}>{unlockedCelebration}</Text>
            </View>
            <TouchableOpacity onPress={() => setUnlockedCelebration(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss">
              <Ionicons name="close" size={18} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
          </PopIn>
        </>
      )}

      <ShareCardSheet visible={shareOpen} cards={cards} onClose={() => setShareOpen(false)} />
    </ScreenTransition>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { padding: Spacing.containerPadding, gap: Spacing.lg, paddingBottom: 120 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md },
  headerLogo: { fontFamily: C.fontDisplay, fontSize: 16, color: C.primary, letterSpacing: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },

  titleSection: { gap: 4 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.28 },

  ringCard: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.md },
  ringLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, alignSelf: 'flex-start' },
  ringWrap: { alignItems: 'center', justifyContent: 'center' },
  ringPercent: { fontFamily: C.fontDisplay, fontSize: 36, color: C.primary, letterSpacing: -1 },
  ringSubLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.textSecondary, letterSpacing: 0.5 },
  ringCaption: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },

  streakCard: { backgroundColor: C.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.xs },
  streakRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streakTag: { fontFamily: 'Inter_700Bold', fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.6 },
  streakNum: { fontFamily: C.fontDisplay, fontSize: 48, color: '#FFFFFF', letterSpacing: -1.5, lineHeight: 52 },
  streakUnit: { fontFamily: 'Inter_400Regular', fontSize: 24, color: 'rgba(255,255,255,0.8)' },
  streakCaption: { fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 20 },

  statCard: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md, ...CardShadow },
  statLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  statRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  statValue: { fontFamily: C.fontDisplay, fontSize: 36, color: C.text, letterSpacing: -1, lineHeight: 40 },
  statUnit: { fontFamily: 'Inter_400Regular', fontSize: 16, color: C.textSecondary },
  statDelta: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.primary, marginBottom: 4 },
  barTrack: { height: 8, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full },
  barFill: { height: 8, backgroundColor: C.primary, borderRadius: Radius.full },
  milestoneName: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.4 },
  milestoneRemain: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary, marginBottom: 4 },
  milestoneCaption: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary },

  periodToggle: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: 3, gap: 2 },
  periodBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.md },
  periodBtnActive: { backgroundColor: C.primary },
  periodText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline },
  periodTextActive: { color: '#FFFFFF' },

  dayDotLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.outline },
  dayDotLabelActive: { color: C.primary, fontFamily: 'Inter_700Bold' },
  insightRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  insightText: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary },

  unlockToast: {
    position: 'absolute', top: 96, left: Spacing.containerPadding, right: Spacing.containerPadding,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: C.gold, borderRadius: Radius.lg, padding: Spacing.md,
    zIndex: 60,
    shadowColor: '#101114', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 22, elevation: 10,
  },
  unlockIcon: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center',
  },
  unlockLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.8 },
  unlockTitle: { fontFamily: C.fontDisplay, fontSize: 16, color: '#fff', letterSpacing: -0.2 },

  section: { gap: Spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: C.text, letterSpacing: -0.2 },
  sectionAction: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },

  recordRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh },
  recordIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  recordInfo: { flex: 1 },
  recordName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  recordMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  recordRight: { alignItems: 'flex-end' },
  recordValue: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.3 },
  recordUnit: { fontFamily: 'Inter_400Regular', fontSize: 14 },

  achMeta: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline },
  achievementsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  achievementBadge: {
    flexGrow: 1, flexBasis: '30%', maxWidth: '32%', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.sm, alignItems: 'center', gap: 4,
  },
  achievementBadgeLocked: { opacity: 0.7 },
  achBadgeIcon: { width: 48, height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  achLockDot: { position: 'absolute', bottom: -2, right: -2, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, padding: 2 },
  achievementLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.text, textAlign: 'center' },
  achievementLabelLocked: { color: C.outline },
  achDesc: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textSecondary, textAlign: 'center', lineHeight: 13 },
  achProg: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary },

  weekBarsContainer: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 56 },
  weekBarCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  weekBar: { width: '100%', borderRadius: 3 },
  noDataState: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing['2xl'] },
  noDataText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 22 },
})
