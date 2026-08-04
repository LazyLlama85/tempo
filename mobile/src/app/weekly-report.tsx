// Tempo — Weekly Progress Report screen.
//
// The Sunday "am I improving?" answer: workouts, volume vs last week, estimated
// strength gains, weight trend, consistency — then a one-tap share. All numbers
// come from computeWeeklyReport (lib/weeklyReport.ts); the share reuses the
// existing Wrapped cards.

import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBanner } from '@/components/ErrorBanner'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, Redirect } from 'expo-router'
import { Spacing, Radius, CardShadow } from '@/constants/theme'
import { BRAND_NAME } from '@/constants/brand'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { computeWeeklyReport, reportHasContent, type WeeklyReport } from '@/lib/weeklyReport'
import { fetchSchedulingImpact, type SchedulingImpact } from '@/lib/schedulingImpact'
import { buildWrappedCards, type WrappedCard } from '@/lib/wrapped'
import { ShareCardSheet } from '@/components/ShareCardSheet'
import { useWeightUnit, unitLabel, displayWeight, displayVolume, formatWeightDelta } from '@/lib/units'
import { track } from '@/lib/analytics'


export default function WeeklyReportScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const unit = useWeightUnit()

  const [report, setReport] = useState<WeeklyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [reportError, setReportError] = useState(false)
  const [cards, setCards] = useState<WrappedCard[]>([])
  const [impact, setImpact] = useState<SchedulingImpact | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (!userId) return
    track('weekly_report_viewed')
    setLoading(true)
    setReportError(false)
    computeWeeklyReport(supabase, userId)
      .then((r) => { setReport(r); setLoading(false) })
      // A missing .catch here used to leave `loading` stuck true forever on
      // any failure — the screen showed "Building your report…" permanently.
      .catch(() => { setLoading(false); setReportError(true) })
    buildWrappedCards(supabase, userId).then(setCards).catch(() => setCards([]))
    fetchSchedulingImpact(supabase, userId).then(setImpact).catch(() => {})
  }, [userId, retryTick])

  if (!session) return <Redirect href="/sign-in" />

  const volLine = report?.volumeDeltaPct == null
    ? 'First week of volume logged'
    : `${report.volumeDeltaPct >= 0 ? '+' : ''}${report.volumeDeltaPct}% vs last week`
  const wkLine = report
    ? report.prevWorkouts > 0
      ? `${report.workouts >= report.prevWorkouts ? '+' : ''}${report.workouts - report.prevWorkouts} vs last week`
      : 'Keep it rolling'
    : ''

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader
        title="Your Week"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Building your report…" /></View>
      ) : reportError ? (
        <View style={[styles.center, { paddingHorizontal: Spacing.lg }]}>
          <ErrorBanner
            message="Couldn't build your report. Check your connection and try again."
            onRetry={() => setRetryTick(t => t + 1)}
          />
        </View>
      ) : !report || !reportHasContent(report) ? (
        <View style={styles.center}>
          <EmptyState kind="chart" title="No report yet" body="Finish a workout this week and your report fills in — volume, PRs, and momentum vs. last week." />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.lead}>Here's your progress this week. The numbers don't lie — you're moving.</Text>

          {/* Workouts + consistency tiles */}
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>WORKOUTS</Text>
              <Text style={styles.tileValue}>{report.workouts}</Text>
              <Text style={styles.tileSub}>{wkLine}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>CONSISTENCY</Text>
              <Text style={styles.tileValue}>{report.consistencyPct}%</Text>
              <Text style={styles.tileSub}>of planned sessions</Text>
            </View>
          </View>

          {/* The wedge, made visible: how much of this week Tempo actually planned +
              scheduled for you. Hidden when zero (honest empty state). */}
          {impact && impact.thisWeek > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>PLANNED & SCHEDULED BY TEMPO</Text>
              <Text style={styles.cardValue}>{impact.thisWeek} this week</Text>
              <Text style={styles.cardSub}>
                {impact.scheduledByTempo > impact.thisWeek
                  ? `${BRAND_NAME} has fit ${impact.scheduledByTempo} workouts into your week so far — the what and the when, handled, so you just show up.`
                  : `${BRAND_NAME} picked the exercises and slotted the time around your real schedule — you just showed up.`}
              </Text>
            </View>
          )}

          {/* Volume */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardLabel}>VOLUME LIFTED</Text>
              <View style={[styles.deltaPill, (report.volumeDeltaPct ?? 0) >= 0 ? styles.deltaUp : styles.deltaDown]}>
                <Ionicons
                  name={(report.volumeDeltaPct ?? 0) >= 0 ? 'trending-up' : 'trending-down'}
                  size={13}
                  color={(report.volumeDeltaPct ?? 0) >= 0 ? C.success : C.error}
                />
                <Text style={[styles.deltaText, { color: (report.volumeDeltaPct ?? 0) >= 0 ? C.success : C.error }]}>{volLine}</Text>
              </View>
            </View>
            <Text style={styles.cardValue}>{displayVolume(report.volumeLbs, unit)} <Text style={styles.cardUnit}>{unitLabel(unit)}</Text></Text>
            <Text style={styles.cardSub}>{report.minutes} min trained this week</Text>
          </View>

          {/* Estimated strength */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>ESTIMATED STRENGTH</Text>
            <Text style={styles.cardValue}>
              {report.strongerExercises > 0 ? `Up in ${report.strongerExercises} lift${report.strongerExercises === 1 ? '' : 's'}` : 'Holding steady'}
            </Text>
            {report.strengthGains.length > 0 ? (
              <View style={styles.gainList}>
                {report.strengthGains.map((g) => (
                  <View key={g.name} style={styles.gainRow}>
                    <Ionicons name="trending-up" size={14} color={C.success} />
                    <Text style={styles.gainName} numberOfLines={1}>{g.name}</Text>
                    <Text style={styles.gainDelta}>+{displayWeight(g.deltaLbs, unit)} {unitLabel(unit)} est. 1RM</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.cardSub}>Log heavier or more reps to push your estimated maxes.</Text>
            )}
          </View>

          {/* Weight + PRs */}
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>WEIGHT TREND</Text>
              <Text style={[styles.tileValue, { fontSize: 22 }]}>
                {report.weightPerWeek == null ? '—' : `${formatWeightDelta(report.weightPerWeek, unit)}/wk`}
              </Text>
              <Text style={styles.tileSub}>{report.weightPerWeek == null ? 'Log your weight' : 'this month'}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>NEW PRs</Text>
              <Text style={styles.tileValue}>{report.newPRs}</Text>
              <Text style={styles.tileSub}>this week</Text>
            </View>
          </View>

          {cards.length > 0 && (
            <TouchableOpacity style={styles.shareBtn} onPress={() => setShareOpen(true)} activeOpacity={0.85}>
              <Ionicons name="share-outline" size={18} color={C.primary} />
              <Text style={styles.shareBtnText}>Share my week</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      <ShareCardSheet visible={shareOpen} cards={cards} onClose={() => setShareOpen(false)} />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },
  lead: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22, marginTop: Spacing.xs },

  tileRow: { flexDirection: 'row', gap: Spacing.md },
  tile: { flex: 1, backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: 2 },
  tileLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.6 },
  tileValue: { fontFamily: C.fontDisplay, fontSize: 30, color: C.text, letterSpacing: -1 },
  tileSub: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },

  card: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  cardValue: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.6 },
  cardUnit: { fontFamily: 'Inter_400Regular', fontSize: 16, color: C.textSecondary },
  cardSub: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, marginTop: 2 },
  deltaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  deltaUp: { backgroundColor: C.successSoft },
  deltaDown: { backgroundColor: C.dangerSoft },
  deltaText: { fontFamily: 'Inter_700Bold', fontSize: 11 },

  gainList: { gap: Spacing.xs, marginTop: Spacing.sm },
  gainRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  gainName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  gainDelta: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.success },

  shareBtn: { height: 52, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.surfaceContainerLow, marginTop: Spacing.xs },
  shareBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
})
