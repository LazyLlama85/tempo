import { useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'expo-router'
import { useProgressStats, type ChartPeriod } from '@/hooks/useProgressStats'
import { ACHIEVEMENTS, type AchievementStats } from '@/lib/achievements'
import { LoadingCard } from '@/components/LoadingCard'
import { ErrorBanner } from '@/components/ErrorBanner'

const C = Colors.light

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

// ── Progress ring using two rotating half-rectangles ──────────────────────────
// Outer circle (overflow:hidden) clips the fills to a circle shape.
// The hole is created by a solid mask circle on top.
function ProgressRing({ pct }: { pct: number }) {
  const SIZE = 140
  const STROKE = 14
  const half = SIZE / 2
  const inner = SIZE - STROKE * 2
  const p = Math.max(0, Math.min(100, pct))

  // Right half fills from 0% → 50% (angle goes 180° → 0°, revealing right half CW from top)
  const rightDeg = 180 - (Math.min(p, 50) / 50) * 180
  // Left half fills from 50% → 100% (angle goes 180° → 0°)
  const leftDeg = 180 - (Math.max(p - 50, 0) / 50) * 180

  return (
    <View style={{ width: SIZE, height: SIZE, borderRadius: half, overflow: 'hidden', backgroundColor: C.surfaceContainerHigh }}>
      {/* Right half: sweeps CW from 12 o'clock to 6 o'clock as pct goes 0→50 */}
      <View style={{ position: 'absolute', top: 0, right: 0, width: half, height: SIZE, overflow: 'hidden' }}>
        <View style={{
          position: 'absolute', top: 0, left: 0, width: half, height: SIZE,
          backgroundColor: C.primary,
          transform: [
            { translateX: -(half / 2) },
            { rotate: `${rightDeg}deg` },
            { translateX: half / 2 },
          ],
        }} />
      </View>

      {/* Left half: sweeps CW from 6 o'clock to 12 o'clock as pct goes 50→100 */}
      {p > 50 && (
        <View style={{ position: 'absolute', top: 0, left: 0, width: half, height: SIZE, overflow: 'hidden' }}>
          <View style={{
            position: 'absolute', top: 0, left: 0, width: half, height: SIZE,
            backgroundColor: C.primary,
            transform: [
              { translateX: half / 2 },
              { rotate: `-${leftDeg}deg` },
              { translateX: -(half / 2) },
            ],
          }} />
        </View>
      )}

      {/* Inner mask — creates the ring hole; must be last (rendered on top) */}
      <View style={{
        position: 'absolute', top: STROKE, left: STROKE,
        width: inner, height: inner, borderRadius: inner / 2,
        backgroundColor: C.surfaceContainerLow,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={styles.ringPercent}>{p}%</Text>
        <Text style={styles.ringSubLabel}>{p >= 80 ? 'TARGET MET' : 'KEEP GOING'}</Text>
      </View>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ProgressScreen() {
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const [period, setPeriod] = useState<ChartPeriod>('M')
  const { stats, isLoading, isError, refetch } = useProgressStats(userId, period)

  const consistency_pct = stats?.consistency_pct ?? 0
  const streak = stats?.streak ?? 0
  const periodVolume = stats?.periodVolume ?? '0'
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
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerLogo}>TEMPO</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => Alert.alert('Notifications', 'No new notifications.')}><Ionicons name="notifications-outline" size={22} color={C.text} /></TouchableOpacity>
          <TouchableOpacity style={styles.avatar} onPress={() => router.push('/(tabs)/profile')}><Ionicons name="person" size={16} color={C.onPrimary} /></TouchableOpacity>
        </View>
      </View>

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
          <View style={styles.noDataState}>
            <Text style={styles.noDataText}>Complete your first workout to see your stats here.</Text>
          </View>
        ) : (
          <>
            {/* Consistency ring */}
            <View style={styles.ringCard}>
              <Text style={styles.ringLabel}>CONSISTENCY SCORE</Text>
              <View style={styles.ringWrap}>
                <ProgressRing pct={consistency_pct} />
              </View>
              <Text style={styles.ringCaption}>
                {consistency_pct > 0
                  ? `${consistency_pct}% completion rate in the last 30 days.`
                  : 'Complete your first workout to start tracking.'}
              </Text>
            </View>

            {/* Streak card */}
            <View style={styles.streakCard}>
              <View style={styles.streakRow}>
                <Ionicons name="flame" size={22} color="rgba(255,255,255,0.8)" />
                <Text style={styles.streakTag}>CURRENT STREAK</Text>
              </View>
              <Text style={styles.streakNum}>
                {streak}{' '}
                <Text style={styles.streakUnit}>Days</Text>
              </Text>
              <Text style={styles.streakCaption}>
                {streak > 0
                  ? `${streak}-day streak — keep the momentum going!`
                  : 'Complete a workout today to start your streak.'}
              </Text>
            </View>

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
                  {periodVolume}{' '}
                  <Text style={styles.statUnit}>lbs</Text>
                </Text>
                <View style={styles.periodToggle}>
                  {(['W', 'M', '6M'] as ChartPeriod[]).map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.periodBtn, p === period && styles.periodBtnActive]}
                      onPress={() => setPeriod(p)}
                    >
                      <Text style={[styles.periodText, p === period && styles.periodTextActive]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.weekBarsContainer}>
                {chartVolumes.map((vol, i) => {
                  const barH = vol > 0 ? Math.max(4, Math.round((vol / maxChartVol) * 44)) : 0
                  const isCurrent = i === chartVolumes.length - 1
                  return (
                    <View key={i} style={styles.weekBarCol}>
                      <View
                        style={[
                          styles.weekBar,
                          {
                            height: barH > 0 ? barH : 2,
                            backgroundColor: barH > 0
                              ? (isCurrent ? C.primary : C.surfaceContainerHigh)
                              : C.surfaceContainerHigh,
                            opacity: barH > 0 ? 1 : 0.4,
                          },
                        ]}
                      />
                      <Text style={[styles.dayDotLabel, isCurrent && styles.dayDotLabelActive]}>
                        {chartLabels[i]}
                      </Text>
                    </View>
                  )
                })}
              </View>
            </View>

            {/* Personal records */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Personal Records</Text>
              </View>
              {prs.length > 0 ? prs.map((pr) => (
                <View key={pr.name} style={styles.recordRow}>
                  <View style={styles.recordIcon}>
                    <Ionicons name="barbell-outline" size={20} color={C.primary} />
                  </View>
                  <View style={styles.recordInfo}>
                    <Text style={styles.recordName}>{pr.name}</Text>
                    <Text style={styles.recordMeta}>{fmtDate(pr.achievedAt)}</Text>
                  </View>
                  <View style={styles.recordRight}>
                    <Text style={styles.recordValue}>
                      {pr.maxWeight} <Text style={styles.recordUnit}>lbs</Text>
                    </Text>
                  </View>
                </View>
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { padding: Spacing.containerPadding, gap: Spacing.lg, paddingBottom: 120 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md },
  headerLogo: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: C.primary, letterSpacing: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },

  titleSection: { gap: 4 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, color: C.text, letterSpacing: -0.28 },

  ringCard: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.md },
  ringLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, alignSelf: 'flex-start' },
  ringWrap: { alignItems: 'center', justifyContent: 'center' },
  ringPercent: { fontFamily: 'Inter_800ExtraBold', fontSize: 36, color: C.primary, letterSpacing: -1 },
  ringSubLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.textSecondary, letterSpacing: 0.5 },
  ringCaption: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },

  streakCard: { backgroundColor: C.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.xs },
  streakRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streakTag: { fontFamily: 'Inter_700Bold', fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.6 },
  streakNum: { fontFamily: 'Inter_800ExtraBold', fontSize: 48, color: '#FFFFFF', letterSpacing: -1.5, lineHeight: 52 },
  streakUnit: { fontFamily: 'Inter_400Regular', fontSize: 24, color: 'rgba(255,255,255,0.8)' },
  streakCaption: { fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 20 },

  statCard: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md, ...CardShadow },
  statLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  statRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 36, color: C.text, letterSpacing: -1, lineHeight: 40 },
  statUnit: { fontFamily: 'Inter_400Regular', fontSize: 16, color: C.textSecondary },
  statDelta: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.primary, marginBottom: 4 },
  barTrack: { height: 8, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full },
  barFill: { height: 8, backgroundColor: C.primary, borderRadius: Radius.full },
  milestoneName: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: C.text, letterSpacing: -0.4 },
  milestoneRemain: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary, marginBottom: 4 },
  milestoneCaption: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary },

  periodToggle: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: 3, gap: 2 },
  periodBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.md },
  periodBtnActive: { backgroundColor: C.primary },
  periodText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline },
  periodTextActive: { color: '#FFFFFF' },

  dayDotLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.outline },
  dayDotLabelActive: { color: C.primary, fontFamily: 'Inter_700Bold' },

  section: { gap: Spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: C.text, letterSpacing: -0.2 },

  recordRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh },
  recordIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  recordInfo: { flex: 1 },
  recordName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  recordMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  recordRight: { alignItems: 'flex-end' },
  recordValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.text, letterSpacing: -0.3 },
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
