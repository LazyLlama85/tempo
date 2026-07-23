// Tempo — Exercise Progress (modal).
//
// One lift's strength story: a per-session estimated-1RM trend (best set of each
// session, Epley via lib/progression.estimate1RM) with best-ever stats. This is
// the "am I actually getting stronger?" proof — aggregate volume charts say how
// much you did; this says whether the number that matters is going up.

import { useEffect, useMemo, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { SvgLineChart } from '@/components/SvgLineChart'
import { estimate1RM } from '@/lib/progression'
import { useWeightUnit, unitLabel, displayWeight, formatWeight } from '@/lib/units'
import { ProGate } from '@/components/ProGate'
import { computePRForecast } from '@/lib/prForecast'

interface SessionPoint {
  date: Date
  bestWeight: number   // lbs
  bestE1rm: number     // lbs
  topReps: number      // reps at bestWeight
}

const MAX_BARS = 12

export default function ExerciseProgressScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { exerciseId, name } = useLocalSearchParams<{ exerciseId?: string; name?: string }>()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const unit = useWeightUnit()

  const [loading, setLoading] = useState(true)
  const [exName, setExName] = useState(name ?? '')
  const [points, setPoints] = useState<SessionPoint[]>([])

  useEffect(() => {
    if (!userId || !exerciseId) { setLoading(false); return }
    ;(async () => {
      try {
        if (!name) {
          const { data: ex } = await supabase.from('exercises').select('name').eq('id', exerciseId).maybeSingle()
          if (ex?.name) setExName(ex.name as string)
        }
        // RLS scopes set_logs to the caller via workout_logs ownership.
        const { data: sets } = await supabase
          .from('set_logs')
          .select('workout_log_id, weight_lbs, reps_completed, completed_at')
          .eq('exercise_id', exerciseId)
          .not('weight_lbs', 'is', null)
          .not('is_warmup', 'is', true) // strength story = working sets only
          .order('completed_at', { ascending: true })

        // One point per session (workout_log): the best set by estimated 1RM.
        const byLog = new Map<string, SessionPoint>()
        for (const s of (sets ?? []) as any[]) {
          const w = s.weight_lbs as number
          if (!w || w <= 0) continue
          const reps = (s.reps_completed as number) || 1
          const e1 = estimate1RM(w, reps)
          const cur = byLog.get(s.workout_log_id as string)
          if (!cur || e1 > cur.bestE1rm) {
            byLog.set(s.workout_log_id as string, {
              date: new Date((s.completed_at as string) ?? Date.now()),
              bestWeight: w,
              bestE1rm: e1,
              topReps: reps,
            })
          } else if (w > cur.bestWeight) {
            cur.bestWeight = w
          }
        }
        setPoints([...byLog.values()].sort((a, b) => a.date.getTime() - b.date.getTime()))
      } finally {
        setLoading(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, exerciseId])

  const shown = points.slice(-MAX_BARS)
  const latest = points[points.length - 1]
  const bestEver = points.reduce((m, p) => Math.max(m, p.bestE1rm), 0)
  const bestWeightEver = points.reduce((m, p) => Math.max(m, p.bestWeight), 0)

  // Change vs ~30 days ago: compare the latest e1RM with the last session at
  // least 30 days older (falls back to the first session).
  const monthAgo = Date.now() - 30 * 86_400_000
  const baseline = [...points].reverse().find(p => p.date.getTime() <= monthAgo) ?? points[0]
  const delta30 = latest && baseline && latest !== baseline
    ? Math.round(latest.bestE1rm - baseline.bestE1rm)
    : null

  const fmtDay = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`

  // Foresight, not a chart — LAUNCH_SCORE_PLAN.md T2.1. Computed from the SAME
  // free per-session data the chart above already has; only the CARD is
  // Pro-gated, not the underlying calculation, so a free user with enough
  // history gets a real, earned paywall moment instead of a lock icon over
  // nothing. Returns null (renders nothing at all) when there isn't enough
  // signal for an honest projection — never a fabricated ETA.
  const forecast = useMemo(
    () => computePRForecast(points.map((p) => ({ date: p.date, e1rm: p.bestE1rm }))),
    [points],
  )

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Progress"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close exercise progress" />}
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading your progress…" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text style={styles.eyebrow}>STRENGTH TREND</Text>
          <Text style={styles.title}>{exName || 'Exercise'}</Text>

          {points.length === 0 ? (
            <EmptyState kind="chart" title="No trend yet" body="Log a few weighted sessions of this lift and its strength trend shows up here." />
          ) : (
            <>
              {/* Stat tiles */}
              <View style={styles.tileRow}>
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>BEST EST. 1RM</Text>
                  <Text style={styles.tileValue}>
                    {displayWeight(bestEver, unit)}
                    <Text style={styles.tileUnit}> {unitLabel(unit)}</Text>
                  </Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>HEAVIEST SET</Text>
                  <Text style={styles.tileValue}>
                    {displayWeight(bestWeightEver, unit)}
                    <Text style={styles.tileUnit}> {unitLabel(unit)}</Text>
                  </Text>
                </View>
              </View>
              {delta30 !== null && (
                <View style={[styles.deltaChip, delta30 >= 0 ? styles.deltaUp : styles.deltaDown]}>
                  <Ionicons
                    name={delta30 >= 0 ? 'trending-up' : 'trending-down'}
                    size={14}
                    color={delta30 >= 0 ? C.success : C.error}
                  />
                  <Text style={[styles.deltaText, { color: delta30 >= 0 ? C.success : C.error }]}>
                    {delta30 >= 0 ? '+' : '−'}{displayWeight(Math.abs(delta30), unit)} {unitLabel(unit)} est. 1RM vs a month ago
                  </Text>
                </View>
              )}

              {/* Per-session e1RM trend (last 12 sessions) */}
              <View style={styles.chartCard}>
                <View style={styles.chartHeaderRow}>
                  <Text style={styles.chartLabel}>EST. 1RM PER SESSION · LAST {shown.length}</Text>
                  <Text style={styles.barValue}>{displayWeight(shown[shown.length - 1].bestE1rm, unit)} {unitLabel(unit)}</Text>
                </View>
                {/* Shared line+area primitive (same as the Progress tab's weight
                    trend) — reads better than bars for "is this going up" at a glance. */}
                <SvgLineChart
                  points={shown.map((p) => ({ label: fmtDay(p.date), value: p.bestE1rm }))}
                  height={128}
                  color={C.primary}
                />
                <View style={styles.barsRow}>
                  {shown.map((p, i) => (
                    <View key={i} style={styles.barCol}>
                      <Text style={[styles.barDate, i === shown.length - 1 && styles.barDateActive]} numberOfLines={1}>
                        {shown.length <= 6 || i % 2 === (shown.length - 1) % 2 ? fmtDay(p.date) : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Foresight (Pro) — the payable half of this screen. Only renders
                  at all when computePRForecast found an honest, real trend;
                  otherwise there is nothing to gate. */}
              {forecast && (
                <ProGate feature="pr_forecasting">
                  <View style={styles.forecastCard}>
                    <View style={styles.forecastIcon}>
                      <Ionicons name="trending-up" size={20} color={C.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.forecastEyebrow}>PROJECTED</Text>
                      <Text style={styles.forecastHeadline}>
                        {displayWeight(forecast.targetLbs, unit)} {unitLabel(unit)} by {forecast.projectedDateLabel}
                      </Text>
                      <Text style={styles.forecastSub}>
                        At your current pace of +{displayWeight(forecast.ratePerWeek, unit)} {unitLabel(unit)}/week est. 1RM
                      </Text>
                    </View>
                  </View>
                </ProGate>
              )}

              {/* Latest session summary */}
              {latest && (
                <View style={styles.latestRow}>
                  <Ionicons name="barbell-outline" size={15} color={C.textSecondary} />
                  <Text style={styles.latestText}>
                    Last session: {formatWeight(latest.bestWeight, unit)} × {latest.topReps} · est. 1RM {formatWeight(latest.bestE1rm, unit)}
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.sm },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 26, color: C.text, letterSpacing: -0.3, marginTop: -4 },

  emptyBox: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 21 },

  tileRow: { flexDirection: 'row', gap: Spacing.sm },
  tile: {
    flex: 1, backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, padding: Spacing.md, gap: 2, ...CardShadow,
  },
  tileLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.6 },
  tileValue: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.5 },
  tileUnit: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary },

  deltaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  deltaUp: { backgroundColor: C.successSoft },
  deltaDown: { backgroundColor: C.dangerSoft },
  deltaText: { fontFamily: 'Inter_700Bold', fontSize: 12 },

  chartCard: {
    backgroundColor: C.background, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: C.outlineVariant, padding: Spacing.md, gap: Spacing.sm, ...CardShadow,
  },
  chartLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.6 },
  chartHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barsRow: { flexDirection: 'row', gap: 4 },
  barCol: { flex: 1, alignItems: 'center' },
  barValue: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },
  barDate: { fontFamily: 'Inter_500Medium', fontSize: 9, color: C.outline, height: 12 },
  barDateActive: { color: C.primary, fontFamily: 'Inter_700Bold' },

  latestRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  latestText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary },

  forecastCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.primarySoft, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: C.primaryLine,
  },
  forecastIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: C.background, alignItems: 'center', justifyContent: 'center',
  },
  forecastEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.6 },
  forecastHeadline: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, marginTop: 2 },
  forecastSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, marginTop: 2 },
})
