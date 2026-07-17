// Tempo — Session Detail (modal).
//
// Everything a completed session actually was: every exercise, every set, the
// weights/reps/RPE logged, and the session's PRs. Opened from a completed card on
// Home ("Details") or a row in Workout History — the proof-of-work view a lifter
// checks before repeating a session ("what did I do last Tuesday?").

import { useEffect, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { PressableScale } from '@/components/motion'
import { Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { detectSessionPRs, prLine, type SessionPR } from '@/lib/prs'
import { useWeightUnit, unitLabel, formatWeight, displayVolume, toInputString, inputToLbs, type WeightUnit } from '@/lib/units'
import { describeSaveError } from '@/lib/saveErrors'
import { invalidateTrainingData } from '@/lib/queryInvalidation'
import { getUnilateralPref, setUnilateralPref } from '@/lib/unilateralPrefs'

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
  const queryClient = useQueryClient()

  const [loading, setLoading] = useState(true)
  const [focus, setFocus] = useState('')
  const [dateStr, setDateStr] = useState('')
  const [minutes, setMinutes] = useState<number | null>(null)
  const [groups, setGroups] = useState<ExerciseGroup[]>([])
  const [prs, setPrs] = useState<SessionPR[]>([])
  const [totalVolume, setTotalVolume] = useState(0)
  const [logId, setLogId] = useState<string | null>(null)
  // Logged it wrong, want to fix it after the fact — this screen used to be
  // pure read-only. Editing one set at a time; the draft holds display-unit
  // strings (matching the runner's own TextInput convention).
  const [editing, setEditing] = useState<{ exId: string; setNumber: number } | null>(null)
  const [editDraft, setEditDraft] = useState({ lbs: '', reps: '', durationSec: '', distanceM: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editPerSide, setEditPerSide] = useState(false)

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
        setLogId(log.id as string)

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

  const startEdit = (exId: string, exName: string, s: SetRow) => {
    setEditing({ exId, setNumber: s.set_number })
    setEditPerSide(getUnilateralPref(exName))
    setEditDraft({
      // Always shows the stored total, regardless of the per-side toggle —
      // "this is what's saved." The toggle only changes how a NEW number you
      // type here gets interpreted when you save.
      lbs: toInputString(s.weight_lbs, unit),
      reps: s.reps_completed ? String(s.reps_completed) : '',
      durationSec: s.duration_sec != null ? String(s.duration_sec) : '',
      distanceM: s.distance_m != null ? String(s.distance_m) : '',
    })
  }

  const saveEdit = async () => {
    const target = editing
    if (!target || !logId || savingEdit) return
    setSavingEdit(true)
    try {
      const rawLbs = editDraft.lbs ? inputToLbs(editDraft.lbs, unit) : null
      const patch = {
        weight_lbs: rawLbs != null && editPerSide ? rawLbs * 2 : rawLbs,
        reps_completed: parseInt(editDraft.reps, 10) || 0,
        duration_sec: editDraft.durationSec ? parseInt(editDraft.durationSec, 10) : null,
        distance_m: editDraft.distanceM ? parseFloat(editDraft.distanceM) : null,
      }
      const { error } = await supabase
        .from('set_logs')
        .update(patch)
        .eq('workout_log_id', logId)
        .eq('exercise_id', target.exId)
        .eq('set_number', target.setNumber)
      if (error) {
        const info = describeSaveError(error, 'save that edit')
        Alert.alert('Couldn’t save the edit', info.message)
        return
      }
      // Reflect it locally (this screen doesn't re-fetch on its own) and
      // recompute the volume total the same way the initial load did.
      setGroups(prev => prev.map(g => g.id !== target.exId ? g : {
        ...g,
        sets: g.sets.map(s => s.set_number !== target.setNumber ? s : { ...s, ...patch }),
      }))
      setTotalVolume(prev => {
        const before = groups.find(g => g.id === target.exId)?.sets.find(s => s.set_number === target.setNumber)
        const beforeVol = before?.weight_lbs != null ? before.weight_lbs * (before.reps_completed ?? 0) : 0
        const afterVol = patch.weight_lbs != null ? patch.weight_lbs * (patch.reps_completed ?? 0) : 0
        return Math.max(0, Math.round(prev - beforeVol + afterVol))
      })
      // Progress's volume/PR math re-derives live from set_logs — nothing else
      // caches a stale copy, so invalidating the shared keys is enough.
      invalidateTrainingData(queryClient)
      setEditing(null)
    } finally {
      setSavingEdit(false)
    }
  }

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
                {g.sets.map(s => {
                  const isEditing = editing?.exId === g.id && editing?.setNumber === s.set_number
                  if (isEditing) {
                    return (
                      <View key={s.set_number}>
                      <View style={styles.editRow}>
                        <Text style={styles.setNum}>{s.set_number}</Text>
                        {s.weight_lbs != null && (
                          <TextInput
                            style={styles.editInput}
                            value={editDraft.lbs}
                            onChangeText={v => setEditDraft(d => ({ ...d, lbs: v }))}
                            keyboardType="decimal-pad"
                            placeholder={unitLabel(unit)}
                            placeholderTextColor={C.outline}
                            autoFocus
                          />
                        )}
                        {(s.weight_lbs != null || (s.duration_sec == null && s.distance_m == null)) && (
                          <TextInput
                            style={styles.editInput}
                            value={editDraft.reps}
                            onChangeText={v => setEditDraft(d => ({ ...d, reps: v }))}
                            keyboardType="number-pad"
                            placeholder="reps"
                            placeholderTextColor={C.outline}
                          />
                        )}
                        {s.duration_sec != null && (
                          <TextInput
                            style={styles.editInput}
                            value={editDraft.durationSec}
                            onChangeText={v => setEditDraft(d => ({ ...d, durationSec: v }))}
                            keyboardType="number-pad"
                            placeholder="sec"
                            placeholderTextColor={C.outline}
                          />
                        )}
                        {s.distance_m != null && (
                          <TextInput
                            style={styles.editInput}
                            value={editDraft.distanceM}
                            onChangeText={v => setEditDraft(d => ({ ...d, distanceM: v }))}
                            keyboardType="decimal-pad"
                            placeholder="m"
                            placeholderTextColor={C.outline}
                          />
                        )}
                        <TouchableOpacity onPress={() => setEditing(null)} hitSlop={8}>
                          <Ionicons name="close" size={18} color={C.outline} />
                        </TouchableOpacity>
                        <PressableScale onPress={saveEdit} scaleTo={0.9} hitSlop={8} disabled={savingEdit}>
                          <Ionicons name="checkmark-circle" size={22} color={C.primary} />
                        </PressableScale>
                      </View>
                      {s.weight_lbs != null && (
                        <TouchableOpacity
                          style={styles.perSideRow}
                          onPress={() => { setEditPerSide(v => !v); setUnilateralPref(g.name, !editPerSide) }}
                          activeOpacity={0.7}
                        >
                          <Ionicons name={editPerSide ? 'checkbox' : 'square-outline'} size={14} color={editPerSide ? C.primary : C.outline} />
                          <Text style={[styles.perSideText, editPerSide && { color: C.primary }]}>Logging this weight per side (×2)</Text>
                        </TouchableOpacity>
                      )}
                      </View>
                    )
                  }
                  return (
                    <TouchableOpacity
                      key={s.set_number}
                      style={styles.setRow}
                      activeOpacity={0.6}
                      onPress={() => startEdit(g.id, g.name, s)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit set ${s.set_number}`}
                    >
                      <Text style={styles.setNum}>{s.set_number}</Text>
                      <Text style={styles.setLine}>{setLine(s, unit)}</Text>
                      {s.rpe != null && <Text style={styles.setRpe}>RPE {s.rpe}</Text>}
                      <Ionicons name="create-outline" size={13} color={C.outlineVariant} />
                    </TouchableOpacity>
                  )
                })}
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
  editRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  perSideRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 4, paddingLeft: 20 },
  perSideText: { fontFamily: 'Inter_500Medium', fontSize: 11.5, color: C.textSecondary },
  editInput: {
    flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs, paddingVertical: 6, textAlign: 'center',
  },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 21 },
})
