// Tempo — Workout History (modal).
//
// The training log: every completed session, newest first, each tappable into a
// full session detail. This is the "what did I actually do?" record that proves
// progress — aggregate charts answer "how much", this answers "when and what".

import { useCallback, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { FadeInView } from '@/components/motion'
import { useWeightUnit, unitLabel, displayVolume } from '@/lib/units'
import { workoutOrigin } from '@/lib/workoutOrigin'
import { useProAccess } from '@/stores/entitlements'
import { ProLockCard } from '@/components/ProGate'
import { historyCutoffDate } from '@/lib/historyHorizon'
import { toDateStr } from '@/lib/dates'
import type { WorkoutSource } from '@/types'

// Free tier's cap (lib/historyHorizon.ts) is comfortably under 90 sessions for
// virtually anyone, so the existing row cap doubles as a harmless safety net
// there. Pro's promise is "no cutoff" — raised well past what the free date
// filter would ever reach, not literally unbounded (an unbounded query for a
// years-deep power user would be a real perf/UX risk this screen doesn't need
// to take on to deliver "full history" in practice).
const FREE_ROW_LIMIT = 90
const PRO_ROW_LIMIT = 500

interface HistoryRow {
  id: string               // scheduled_workouts.id
  focus: string
  planned_date: string
  minutes: number | null
  sets: number
  volumeLbs: number
  source: WorkoutSource | null
}

function dateLabel(ds: string): string {
  const d = new Date(`${ds}T00:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function WorkoutHistoryScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const unit = useWeightUnit()
  const { locked } = useProAccess()

  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hasHiddenHistory, setHasHiddenHistory] = useState(false)

  const load = useCallback(() => {
    if (!userId) return
    ;(async () => {
      try {
        let q = supabase
          .from('scheduled_workouts')
          .select('id, focus, planned_date, actual_duration_min, planned_duration_min, source')
          .eq('user_id', userId)
          .eq('status', 'completed')
        // Free tier's 4-month horizon (lib/historyHorizon.ts) — data is never
        // deleted, this is a read-time filter only; Pro removes it entirely.
        if (locked) q = q.gte('planned_date', toDateStr(historyCutoffDate()))
        const { data: workouts } = await q
          .order('planned_date', { ascending: false })
          .limit(locked ? FREE_ROW_LIMIT : PRO_ROW_LIMIT)
        const ws = (workouts ?? []) as any[]

        // Cheap existence check — only when locked, only a single row — so the
        // upsell banner only shows when there's genuinely older history to sell.
        if (locked) {
          const { data: older } = await supabase
            .from('scheduled_workouts')
            .select('id')
            .eq('user_id', userId)
            .eq('status', 'completed')
            .lt('planned_date', toDateStr(historyCutoffDate()))
            .limit(1)
          setHasHiddenHistory(!!older?.length)
        } else {
          setHasHiddenHistory(false)
        }

        if (!ws.length) { setRows([]); return }

        const { data: logs } = await supabase
          .from('workout_logs')
          .select('id, scheduled_workout_id')
          .eq('user_id', userId)
          .in('scheduled_workout_id', ws.map(w => w.id))
        const logByWorkout = new Map<string, string>()
        for (const l of (logs ?? []) as any[]) {
          // Prefer the first log we see per workout (they're rare duplicates anyway).
          if (!logByWorkout.has(l.scheduled_workout_id)) logByWorkout.set(l.scheduled_workout_id, l.id)
        }

        const logIds = [...logByWorkout.values()]
        const setAgg = new Map<string, { sets: number; volume: number }>()
        if (logIds.length) {
          const { data: sets } = await supabase
            .from('set_logs')
            .select('workout_log_id, weight_lbs, reps_completed')
            .in('workout_log_id', logIds)
            .not('is_warmup', 'is', true) // per-session set count + volume exclude warm-ups
          for (const s of (sets ?? []) as any[]) {
            const agg = setAgg.get(s.workout_log_id) ?? { sets: 0, volume: 0 }
            agg.sets += 1
            if (s.weight_lbs != null) agg.volume += s.weight_lbs * (s.reps_completed ?? 0)
            setAgg.set(s.workout_log_id, agg)
          }
        }

        setRows(ws.map(w => {
          const logId = logByWorkout.get(w.id)
          const agg = logId ? setAgg.get(logId) : undefined
          return {
            id: w.id,
            focus: w.focus,
            planned_date: w.planned_date,
            minutes: w.actual_duration_min ?? w.planned_duration_min ?? null,
            sets: agg?.sets ?? 0,
            volumeLbs: Math.round(agg?.volume ?? 0),
            source: (w as { source?: WorkoutSource | null }).source ?? null,
          }
        }))
      } finally {
        setLoading(false)
      }
    })()
  }, [userId, locked])
  useFocusEffect(load)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="History"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close history" />}
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading your history…" /></View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <EmptyState kind="barbell" title="No history yet" body="Your training log builds itself from here — every completed session, newest first." />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {rows.map((r, i) => (
            <FadeInView key={r.id} delay={Math.min(i * 30, 240)}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push({ pathname: '/session-detail', params: { scheduledId: r.id } } as any)}
                activeOpacity={0.75}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="barbell-outline" size={18} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitleRow}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{r.focus}</Text>
                    {(() => {
                      const origin = workoutOrigin(r.source)
                      return (
                        <View style={[styles.originChip, origin.byTempo ? styles.originChipTempo : styles.originChipYours]}>
                          <Ionicons name={origin.icon as any} size={10} color={origin.byTempo ? C.primary : C.textSecondary} />
                          <Text style={[styles.originText, { color: origin.byTempo ? C.primary : C.textSecondary }]}>{origin.short}</Text>
                        </View>
                      )
                    })()}
                  </View>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {dateLabel(r.planned_date)}
                    {r.sets > 0 ? ` · ${r.sets} set${r.sets === 1 ? '' : 's'}` : ''}
                    {r.volumeLbs > 0 ? ` · ${displayVolume(r.volumeLbs, unit)} ${unitLabel(unit)}` : ''}
                    {r.minutes ? ` · ${r.minutes} min` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.outline} />
              </TouchableOpacity>
            </FadeInView>
          ))}
          {/* Free tier's 4-month horizon (lib/historyHorizon.ts) — only shown
              when there's genuinely older history being held back. */}
          {hasHiddenHistory && <ProLockCard feature="full_history" />}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.xs },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 21 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant,
    padding: Spacing.md, ...CardShadow,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center',
  },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  rowTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text, flexShrink: 1 },
  rowMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  originChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1,
  },
  originChipTempo: { backgroundColor: C.primarySoft, borderColor: 'transparent' },
  originChipYours: { backgroundColor: C.surfaceContainerLow, borderColor: C.outlineVariant },
  originText: { fontFamily: 'Inter_700Bold', fontSize: 9.5, letterSpacing: 0.3 },
})
