// Tempo — Exercise Progress (modal).
//
// One lift's strength story: a per-session estimated-1RM trend (best set of each
// session, Epley via lib/progression.estimate1RM) with best-ever stats. This is
// the "am I actually getting stronger?" proof — aggregate volume charts say how
// much you did; this says whether the number that matters is going up.

import { useEffect, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { PulseLoader } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { estimate1RM } from '@/lib/progression'
import { useWeightUnit, unitLabel, displayWeight, formatWeight } from '@/lib/units'

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
  const maxE1 = Math.max(...shown.map(p => p.bestE1rm), 1)
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close exercise progress">
          <Ionicons name="chevron-down" size={26} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Progress</Text>
        <View style={{ width: 26 }} />
      </View>

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

              {/* Per-session e1RM bars (last 12 sessions) */}
              <View style={styles.chartCard}>
                <Text style={styles.chartLabel}>EST. 1RM PER SESSION · LAST {shown.length}</Text>
                <View style={styles.barsRow}>
                  {shown.map((p, i) => {
                    const h = Math.max(6, Math.round((p.bestE1rm / maxE1) * 96))
                    const isLast = i === shown.length - 1
                    return (
                      <View key={i} style={styles.barCol}>
                        {isLast && (
                          <Text style={styles.barValue}>{displayWeight(p.bestE1rm, unit)}</Text>
                        )}
                        <View
                          style={[
                            styles.bar,
                            { height: h, backgroundColor: isLast ? C.primary : C.surfaceContainerHigh },
                          ]}
                        />
                        <Text style={[styles.barDate, isLast && styles.barDateActive]} numberOfLines={1}>
                          {shown.length <= 6 || i % 2 === (shown.length - 1) % 2 ? fmtDay(p.date) : ''}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              </View>

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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm,
  },
  headerTitle: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
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
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 128 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '100%', borderRadius: 3 },
  barValue: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary },
  barDate: { fontFamily: 'Inter_500Medium', fontSize: 9, color: C.outline, height: 12 },
  barDateActive: { color: C.primary, fontFamily: 'Inter_700Bold' },

  latestRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  latestText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary },
})
