// Tempo — edit a scheduled session (modal).
//
// Tempo-generated (and any other scheduled) workouts are not locked: from the
// session hub the user can add / remove / reorder exercises and pin exact
// sets / reps, and the changes persist on the scheduled row. Per-exercise
// prescriptions are only written for exercises the user actually touched —
// untouched plan exercises keep their adaptive (autoregulated) targets.

import { useEffect, useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { PressableScale } from '@/components/motion'
import { ExercisePickerSheet } from '@/components/ExercisePickerSheet'
import { EXERCISE_COLUMNS, metricsFor } from '@/lib/customExercises'
import { estimateSessionMin } from '@/lib/durationEstimate'
import * as haptics from '@/lib/haptics'
import type { Exercise, WorkoutExerciseConfig } from '@/types'

interface EditItem {
  exercise: Exercise
  sets: number
  reps: number
  // Whether the user pinned sets/reps here (or a config already existed).
  // Untouched plan exercises write NO config, so autoregulation keeps working.
  pinned: boolean
}

export default function EditSessionScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { workoutId } = useLocalSearchParams<{ workoutId?: string }>()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [focus, setFocus] = useState('')
  const [items, setItems] = useState<EditItem[]>([])
  const [hadConfig, setHadConfig] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (!workoutId || !userId) return
    ;(async () => {
      try {
        const { data: row } = await supabase
          .from('scheduled_workouts')
          .select('id, focus, exercise_ids, exercise_config')
          .eq('id', workoutId)
          .eq('user_id', userId)
          .maybeSingle()
        if (!row) return
        setFocus(row.focus ?? '')
        const ids: string[] = row.exercise_ids ?? []
        const cfgs = (row.exercise_config ?? []) as WorkoutExerciseConfig[]
        setHadConfig(cfgs.length > 0)
        const { data: exRows } = ids.length
          ? await supabase.from('exercises').select(EXERCISE_COLUMNS).in('id', ids)
          : { data: [] }
        const byId = new Map(((exRows ?? []) as Exercise[]).map((e) => [e.id, e]))
        setItems(ids
          .map((id) => byId.get(id))
          .filter(Boolean)
          .map((ex) => {
            const cfg = cfgs.find((c) => c.exercise_id === (ex as Exercise).id)
            return {
              exercise: ex as Exercise,
              sets: cfg?.sets ?? 3,
              reps: cfg?.rep_high ?? 10,
              pinned: !!cfg,
            }
          }))
      } finally {
        setLoading(false)
      }
    })()
  }, [workoutId, userId])

  const move = (i: number, dir: -1 | 1) => {
    haptics.tapLight()
    setItems((p) => {
      const j = i + dir
      if (j < 0 || j >= p.length) return p
      const next = [...p]; [next[i], next[j]] = [next[j], next[i]]; return next
    })
  }
  const remove = (i: number) => {
    const it = items[i]
    Alert.alert('Remove exercise?', `${it.exercise.name} will be removed from this workout.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { haptics.tapMedium(); setItems((p) => p.filter((_, idx) => idx !== i)) } },
    ])
  }
  const bump = (i: number, field: 'sets' | 'reps', delta: number) => {
    haptics.tapLight()
    setItems((p) => p.map((it, idx) => idx === i
      ? { ...it, pinned: true, [field]: Math.max(1, Math.min(field === 'sets' ? 8 : 30, it[field] + delta)) }
      : it))
  }
  const add = (ex: Exercise) => {
    if (items.some((it) => it.exercise.id === ex.id)) return
    haptics.tapLight()
    setItems((p) => [...p, { exercise: ex, sets: 3, reps: 10, pinned: false }])
  }

  const save = async () => {
    if (saving) return
    if (items.length === 0) { Alert.alert('Keep one exercise', 'A workout needs at least one exercise — remove the session from the calendar instead if you want it gone.'); return }
    setSaving(true)
    try {
      // Config entries only for pinned exercises (or all, when the workout was
      // fully user-configured to begin with) — see EditItem.pinned.
      const config: WorkoutExerciseConfig[] = items
        .filter((it) => it.pinned || hadConfig)
        .map((it) => ({
          exercise_id: it.exercise.id,
          sets: it.sets,
          rep_low: it.reps,
          rep_high: it.reps,
          weight_lbs: null,
          duration_sec: null,
          distance_m: null,
          metrics: metricsFor(it.exercise),
        }))
      const { error } = await supabase
        .from('scheduled_workouts')
        .update({
          focus: focus.trim() || 'Workout',
          exercise_ids: items.map((it) => it.exercise.id),
          exercise_config: config.length ? config : null,
          planned_duration_min: estimateSessionMin(items.map((it) => ({ sets: it.sets }))),
        })
        .eq('id', workoutId)
        .eq('user_id', userId)
      if (error) throw error
      haptics.success()
      router.back()
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Edit Workout"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
        right={
          <TouchableOpacity onPress={save} disabled={saving} hitSlop={8}>
            {saving ? <ActivityIndicator color={C.primary} /> : <Text style={styles.save}>Save</Text>}
          </TouchableOpacity>
        }
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading workout…" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, Spacing.xl) + 40 }]}>
          <Text style={styles.label}>WORKOUT NAME</Text>
          <TextInput
            style={styles.input}
            value={focus}
            onChangeText={setFocus}
            placeholder="e.g. Push"
            placeholderTextColor={C.outline}
            maxLength={40}
          />

          <Text style={styles.label}>EXERCISES · {items.length}</Text>
          {items.map((it, i) => (
            <View key={it.exercise.id} style={styles.exCard}>
              <View style={styles.exHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exName} numberOfLines={1}>{it.exercise.name}</Text>
                  <Text style={styles.exMeta} numberOfLines={1}>
                    {it.pinned ? `${it.sets} sets × ${it.reps} reps` : 'Sets & reps set by Tempo — tap +/- to pin your own'}
                  </Text>
                </View>
                <View style={styles.exActions}>
                  <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6}>
                    <Ionicons name="chevron-up" size={19} color={i === 0 ? C.outlineVariant : C.outline} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => move(i, 1)} disabled={i === items.length - 1} hitSlop={6}>
                    <Ionicons name="chevron-down" size={19} color={i === items.length - 1 ? C.outlineVariant : C.outline} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(i)} hitSlop={6}>
                    <Ionicons name="close-circle" size={20} color={C.outline} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.stepperRow}>
                <View style={styles.stepper}>
                  <TouchableOpacity onPress={() => bump(i, 'sets', -1)} hitSlop={6} style={styles.stepBtn}><Ionicons name="remove" size={16} color={C.text} /></TouchableOpacity>
                  <Text style={styles.stepValue}>{it.sets}</Text>
                  <TouchableOpacity onPress={() => bump(i, 'sets', 1)} hitSlop={6} style={styles.stepBtn}><Ionicons name="add" size={16} color={C.text} /></TouchableOpacity>
                  <Text style={styles.stepLabel}>sets</Text>
                </View>
                <View style={styles.stepper}>
                  <TouchableOpacity onPress={() => bump(i, 'reps', -1)} hitSlop={6} style={styles.stepBtn}><Ionicons name="remove" size={16} color={C.text} /></TouchableOpacity>
                  <Text style={styles.stepValue}>{it.reps}</Text>
                  <TouchableOpacity onPress={() => bump(i, 'reps', 1)} hitSlop={6} style={styles.stepBtn}><Ionicons name="add" size={16} color={C.text} /></TouchableOpacity>
                  <Text style={styles.stepLabel}>reps</Text>
                </View>
              </View>
            </View>
          ))}

          <PressableScale style={styles.addBtn} onPress={() => setPickerOpen(true)}>
            <Ionicons name="add" size={18} color={C.primary} />
            <Text style={styles.addBtnText}>Add exercise</Text>
          </PressableScale>

          <Text style={styles.hint}>
            Changes apply to this scheduled session. Exercises you don't pin keep Tempo's
            adaptive targets, so progression and deloads still work.
          </Text>
        </ScrollView>
      )}

      <ExercisePickerSheet
        visible={pickerOpen}
        userId={userId}
        client={supabase}
        existingIds={items.map((it) => it.exercise.id)}
        onClose={() => setPickerOpen(false)}
        onAdd={add}
        onRemove={(ex) => setItems((p) => p.filter((it) => it.exercise.id !== ex.id))}
      />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  save: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.primary },
  scroll: { paddingHorizontal: Spacing.containerPadding, gap: Spacing.xs },
  label: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  input: {
    height: 50, backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md,
    fontFamily: 'Inter_700Bold', fontSize: 17, color: C.text, marginTop: Spacing.xs,
  },
  exCard: { backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant, padding: Spacing.md, gap: Spacing.sm, ...CardShadow },
  exHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  exName: { fontFamily: 'Inter_700Bold', fontSize: 15.5, color: C.text },
  exMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  exActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepperRow: { flexDirection: 'row', gap: Spacing.lg },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, minWidth: 20, textAlign: 'center' },
  stepLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.textSecondary },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.md, marginTop: Spacing.xs, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.primary, backgroundColor: C.surfaceContainerLow },
  addBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: Spacing.sm },
})
