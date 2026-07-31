// Tempo — Muscle History.
//
// Full training history for a MUSCLE, not a single lift — `exercise-progress.tsx`
// already owns the per-exercise strength story (est. 1RM trend + PR forecast); a
// single exercise's weight isn't comparable to another's, so the only trend that
// means anything aggregated across a group is training volume (set count). Given
// `muscleGroup` (coarse, e.g. "chest") or `muscleSlug` (fine, e.g. "biceps") this
// screen resolves every exercise that trains it — via the same shared library
// cache the picker/library screens already use — into a sets-per-week trend plus
// a per-exercise breakdown that drills into `exercise-progress` for the lift-level
// detail. Read-only; no new table, no new write path.

import { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { ScreenHeader, DismissButton, PulseLoader } from '@/components/brand'
import { FadeInView, PressableScale } from '@/components/motion'
import { EmptyState } from '@/components/EmptyState'
import { SvgLineChart, type ChartPoint } from '@/components/SvgLineChart'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useExerciseLibrary, muscleGroupOf } from '@/lib/exerciseSearch'
import type { MuscleGroup } from '@/types'

type RangeDays = 90 | 180 | 365 | 0 // 0 = all time
const RANGE_OPTIONS: { days: RangeDays; label: string }[] = [
  { days: 90, label: '3M' },
  { days: 180, label: '6M' },
  { days: 365, label: '1Y' },
  { days: 0, label: 'All' },
]

interface SetRow {
  exercise_id: string
  completed_at: string
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Monday-anchored week buckets — a single exercise's weight isn't comparable to
// another's, so set count is the only trend that means anything aggregated
// across a whole muscle group.
function weekStart(d: Date): Date {
  const nd = new Date(d)
  const day = nd.getDay()
  nd.setDate(nd.getDate() + (day === 0 ? -6 : 1) - day)
  nd.setHours(0, 0, 0, 0)
  return nd
}
function buildWeeklyBuckets(rows: SetRow[]): ChartPoint[] {
  const counts = new Map<number, number>()
  for (const r of rows) {
    const ws = weekStart(new Date(r.completed_at)).getTime()
    counts.set(ws, (counts.get(ws) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ label: shortDate(new Date(t)), value: n }))
}

export default function MuscleHistoryScreen() {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const p = useLocalSearchParams<{ muscleGroup?: string; muscleSlug?: string; title?: string }>()
  const muscleGroup = (p.muscleGroup ?? null) as MuscleGroup | null
  const muscleSlug = p.muscleSlug ?? null
  const title = p.title ?? 'Muscle history'

  const { data: library } = useExerciseLibrary()
  const exerciseNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of library ?? []) m.set(e.id, e.name)
    return m
  }, [library])
  const groupExerciseIds = useMemo(() => {
    if (!library) return null
    if (muscleSlug) return library.filter(e => e.primary_muscles?.includes(muscleSlug) || e.secondary_muscles?.includes(muscleSlug)).map(e => e.id)
    if (muscleGroup) return library.filter(e => muscleGroupOf(e) === muscleGroup).map(e => e.id)
    return []
  }, [muscleSlug, muscleGroup, library])

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<SetRow[]>([])
  const [range, setRange] = useState<RangeDays>(90)

  useEffect(() => {
    if (!userId || groupExerciseIds === null) return
    if (groupExerciseIds.length === 0) { setRows([]); setLoading(false); return }
    setLoading(true)
    supabase.from('set_logs')
      .select('exercise_id, completed_at')
      .in('exercise_id', groupExerciseIds)
      .not('is_warmup', 'is', true)
      .order('completed_at', { ascending: true })
      .limit(4000)
      .then(({ data }) => { setRows((data ?? []) as SetRow[]); setLoading(false) })
  }, [userId, groupExerciseIds])

  const rangeCutoff = range === 0 ? 0 : Date.now() - range * 86_400_000
  const rangeRows = useMemo(() => rows.filter(r => range === 0 || new Date(r.completed_at).getTime() >= rangeCutoff), [rows, range, rangeCutoff])
  const weeklyPoints = useMemo(() => buildWeeklyBuckets(rangeRows), [rangeRows])
  const exerciseBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rangeRows) counts.set(r.exercise_id, (counts.get(r.exercise_id) ?? 0) + 1)
    return [...counts.entries()]
      .map(([id, n]) => ({ id, name: exerciseNameById.get(id) ?? 'Exercise', sets: n }))
      .sort((a, b) => b.sets - a.sets)
  }, [rangeRows, exerciseNameById])
  const lastTrainedAll = useMemo(() => (rows.length ? new Date(Math.max(...rows.map(r => new Date(r.completed_at).getTime()))) : null), [rows])

  const hasData = rows.length > 0

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScreenHeader title={title} size="sm" leading={<DismissButton kind="back" onPress={() => router.back()} label="Back" />} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {loading ? (
          <PulseLoader caption="Reading your history…" />
        ) : !hasData ? (
          <EmptyState kind="chart" title="No history yet" body="Log a few sessions training this muscle to see your trend here." />
        ) : (
          <>
            <View style={s.rangeRow}>
              {RANGE_OPTIONS.map(o => (
                <PressableScale
                  key={o.label}
                  style={[s.rangeChip, range === o.days && s.rangeChipOn]}
                  scaleTo={0.94}
                  onPress={() => setRange(o.days)}
                  accessibilityState={{ selected: range === o.days }}
                  accessibilityLabel={o.label === 'All' ? 'All time' : `Last ${o.label}`}
                >
                  <Text style={[s.rangeChipText, range === o.days && { color: C.onPrimary }]}>{o.label}</Text>
                </PressableScale>
              ))}
            </View>

            <FadeInView style={s.card}>
              <Text style={s.cardLabel}>SETS PER WEEK</Text>
              <SvgLineChart points={weeklyPoints} height={140} />
            </FadeInView>

            <View style={s.statGrid}>
              <Stat s={s} label="Sets in range" value={`${rangeRows.length}`} />
              {exerciseBreakdown[0] && <Stat s={s} label="Most trained" value={exerciseBreakdown[0].name} />}
              <Stat s={s} label="Last trained" value={lastTrainedAll ? shortDate(lastTrainedAll) : '—'} />
            </View>

            <FadeInView style={s.card} delay={20}>
              <Text style={s.cardLabel}>BY EXERCISE</Text>
              {exerciseBreakdown.slice(0, 12).map(row => (
                <PressableScale
                  key={row.id}
                  style={s.breakdownRow}
                  scaleTo={0.98}
                  onPress={() => router.push({ pathname: '/exercise-progress', params: { exerciseId: row.id, name: row.name } } as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`See ${row.name} progress`}
                >
                  <Text style={s.breakdownName} numberOfLines={1}>{row.name}</Text>
                  <Text style={s.breakdownSets}>{row.sets} set{row.sets === 1 ? '' : 's'}</Text>
                </PressableScale>
              ))}
            </FadeInView>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Stat({ s, label, value }: { s: ReturnType<typeof makeStyles>; label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue} numberOfLines={1}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { padding: Spacing.containerPadding, gap: Spacing.lg, paddingBottom: 60 },

  rangeRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs },
  rangeChip: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.pill, backgroundColor: C.surfaceContainerLow },
  rangeChipOn: { backgroundColor: C.primary },
  rangeChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary },

  card: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.card, padding: Spacing.lg, gap: Spacing.sm, ...Elevation.e1 },
  cardLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  stat: { flexGrow: 1, flexBasis: '30%', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm, gap: 2, borderWidth: 1, borderColor: C.outlineVariant },
  statValue: { fontFamily: C.fontDisplay, fontSize: 16, color: C.text, letterSpacing: -0.3 },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary },

  breakdownRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.outlineVariant,
  },
  breakdownName: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text, marginRight: Spacing.sm },
  breakdownSets: { fontFamily: C.fontDisplay, fontSize: 13, color: C.textSecondary },
})
