// Tempo — Session Detail (modal).
//
// Everything a completed session actually was: every exercise, every set, the
// weights/reps/RPE logged, and the session's PRs. Opened from a completed card on
// Home ("Details") or a row in Workout History — the proof-of-work view a lifter
// checks before repeating a session ("what did I do last Tuesday?").

import { useEffect, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { detectSessionPRs, prLine, type SessionPR } from '@/lib/prs'
import { useWeightUnit, unitLabel, formatWeight, displayVolume, type WeightUnit } from '@/lib/units'

interface SetRow {
  exercise_id: string
  set_number: number
  weight_lbs: number | null
  reps_completed: number
  rpe: number | null
  duration_sec: number | null
  distance_m: number | null
}

interface ExerciseGroup {
  id: string
  name: string
  sets: SetRow[]
}

function setLine(s: SetRow, unit: WeightUnit): string {
  if (s.weight_lbs != null) return `${formatWeight(s.weight_lbs, unit)} × ${s.reps_completed}`
  if (s.duration_sec != null && s.distance_m != null) return `${s.distance_m} m · ${s.duration_sec}s`
  if (s.duration_sec != null) return `${s.duration_sec}s`
  if (s.distance_m != null) return `${s.distance_m} m`
  return `${s.reps_completed} reps`
}

export default function SessionDetailScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { scheduledId } = useLocalSearchParams<{ scheduledId?: string }>()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const unit = useWeightUnit()

  const [loading, setLoading] = useState(true)
  const [focus, setFocus] = useState('')
  const [dateStr, setDateStr] = useState('')
  const [minutes, setMinutes] = useState<number | null>(null)
  const [groups, setGroups] = useState<ExerciseGroup[]>([])
  const [prs, setPrs] = useState<SessionPR[]>([])
  const [totalVolume, setTotalVolume] = useState(0)

  useEffect(() => {
    if (!userId || !scheduledId) { setLoading(false); return }
    ;(async () => {
      try {
        const { data: w } = await supabase
          .from('scheduled_workouts')
          .select('id, focus, planned_date, actual_duration_min, planned_duration_min, exercise_ids')
          .eq('id', scheduledId)
          .eq('user_id', userId)
          .maybeSingle()
        if (!w) return
        setFocus(w.focus as string)
        setDateStr(new Date(`${w.planned_date}T00:00:00`).toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric',
        }))
        setMinutes((w.actual_duration_min as number | null) ?? (w.planned_duration_min as number | null))

        // The session's log (prefer the completed one) + its sets.
        const { data: log } = await supabase
          .from('workout_logs')
          .select('id, completed_at')
          .eq('user_id', userId)
          .eq('scheduled_workout_id', w.id)
          .order('completed_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()
        if (!log) { setGroups([]); return }

        const { data: sets } = await supabase
          .from('set_logs')
          .select('exercise_id, set_number, weight_lbs, reps_completed, rpe, duration_sec, distance_m')
          .eq('workout_log_id', log.id)
          .not('is_warmup', 'is', true) // the record shows working sets (warm-ups excluded, as elsewhere)
          .order('set_number')
        const setRows = (sets ?? []) as SetRow[]

        const exIds = [...new Set(setRows.map(s => s.exercise_id))]
        const { data: exRows } = exIds.length
          ? await supabase.from('exercises').select('id, name').in('id', exIds)
          : { data: [] as { id: string; name: string }[] }
        const nameOf = new Map<string, string>((exRows ?? []).map((e: any) => [e.id, e.name]))

        // Present in the workout's programmed order; anything logged beyond the
        // plan (extra swaps etc.) follows after.
        const order = [...((w.exercise_ids ?? []) as string[])]
        for (const id of exIds) if (!order.includes(id)) order.push(id)

        const byEx = new Map<string, SetRow[]>()
        let volume = 0
        for (const s of setRows) {
          ;(byEx.get(s.exercise_id) ?? byEx.set(s.exercise_id, []).get(s.exercise_id)!).push(s)
          if (s.weight_lbs != null) volume += s.weight_lbs * (s.reps_completed ?? 0)
        }
        setTotalVolume(Math.round(volume))
        setGroups(order
          .filter(id => byEx.has(id))
          .map(id => ({ id, name: nameOf.get(id) ?? 'Exercise', sets: byEx.get(id)! })))

        detectSessionPRs(supabase, userId, log.id as string).then(setPrs).catch(() => {})
      } finally {
        setLoading(false)
      }
    })()
  }, [userId, scheduledId])

  const totalSets = groups.reduce((n, g) => n + g.sets.length, 0)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Session"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close session detail" />}
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading this session…" /></View>
      ) : !focus ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Couldn’t load this session.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text style={styles.eyebrow}>{dateStr.toUpperCase()}</Text>
          <Text style={styles.title}>{focus}</Text>

          <View style={styles.statRow}>
            {minutes != null && (
              <View style={styles.statChip}>
                <Ionicons name="time-outline" size={13} color={C.textSecondary} />
                <Text style={styles.statChipText}>{minutes} min</Text>
              </View>
            )}
            {totalSets > 0 && (
              <View style={styles.statChip}>
                <Ionicons name="layers-outline" size={13} color={C.textSecondary} />
                <Text style={styles.statChipText}>{totalSets} sets</Text>
              </View>
            )}
            {totalVolume > 0 && (
              <View style={styles.statChip}>
                <Ionicons name="barbell-outline" size={13} color={C.textSecondary} />
                <Text style={styles.statChipText}>{displayVolume(totalVolume, unit)} {unitLabel(unit)}</Text>
              </View>
            )}
          </View>

          {prs.length > 0 && (
            <View style={styles.prCard}>
              <View style={styles.prHeader}>
                <Ionicons name="trophy" size={15} color="#fff" />
                <Text style={styles.prHeaderText}>
                  {prs.length === 1 ? 'PERSONAL RECORD' : `${prs.length} PERSONAL RECORDS`}
                </Text>
              </View>
              {prs.slice(0, 3).map(pr => (
                <Text key={pr.exercise + pr.kind} style={styles.prText}>{prLine(pr, unit)}</Text>
              ))}
            </View>
          )}

          {groups.length === 0 ? (
            <Text style={styles.emptyText}>No sets were logged in this session.</Text>
          ) : (
            groups.map(g => (
              <View key={g.id} style={styles.exCard}>
                {/* Exercise name → that lift's strength-trend chart */}
                <TouchableOpacity
                  style={styles.exNameRow}
                  onPress={() => router.push({ pathname: '/exercise-progress', params: { exerciseId: g.id, name: g.name } } as any)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.exName}>{g.name}</Text>
                  <Ionicons name="trending-up-outline" size={16} color={C.primary} />
                </TouchableOpacity>
                {g.sets.map(s => (
                  <View key={s.set_number} style={styles.setRow}>
                    <Text style={styles.setNum}>{s.set_number}</Text>
                    <Text style={styles.setLine}>{setLine(s, unit)}</Text>
                    {s.rpe != null && <Text style={styles.setRpe}>RPE {s.rpe}</Text>}
                  </View>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm,
  },
  headerTitle: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.sm },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 26, color: C.text, letterSpacing: -0.3, marginTop: -4 },
  statRow: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  statChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary },
  prCard: { backgroundColor: '#B8860B', borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  prHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prHeaderText: { fontFamily: C.fontDisplay, fontSize: 11, color: '#fff', letterSpacing: 0.6 },
  prText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' },
  exCard: {
    backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, padding: Spacing.md, gap: 6, ...CardShadow,
  },
  exNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  exName: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, letterSpacing: -0.2 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  setNum: { width: 20, fontFamily: 'Inter_700Bold', fontSize: 13, color: C.outline, textAlign: 'center' },
  setLine: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text },
  setRpe: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 21 },
})
