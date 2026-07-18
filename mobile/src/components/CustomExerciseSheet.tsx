// Tempo — create / edit a custom exercise (bottom sheet).
//
// Custom exercises are saved into the shared exercises table so they work like
// built-ins everywhere. Used from the exercise picker ("New exercise") and from the
// My Workouts screen (edit/delete).

import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TempoSheet } from '@/components/TempoSheet'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import {
  EXERCISE_CATEGORIES, METRIC_OPTIONS,
  createCustomExercise, updateCustomExercise, countCustomExercises,
} from '@/lib/customExercises'
import { useCreateLimit } from '@/lib/proLimits'
import type { Exercise, MovementPattern, MetricKey, Equipment } from '@/types'

// Sensible default metrics per category, so a "Cardio" exercise tracks time/distance
// out of the box instead of weight/reps.
function defaultMetricsForCategory(p: MovementPattern): MetricKey[] {
  if (p === 'cardio') return ['duration', 'distance']
  if (p === 'mobility') return ['duration']
  return ['weight', 'reps']
}

const EQUIPMENT: { id: Equipment; label: string }[] = [
  { id: 'bodyweight', label: 'Bodyweight' },
  { id: 'pull_up_bar', label: 'Pull-up / dip bar' },
  { id: 'dumbbells', label: 'Dumbbells' },
  { id: 'barbell', label: 'Barbell' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'resistance_bands', label: 'Bands' },
  { id: 'full_gym', label: 'Machine / Gym' },
]

interface Props {
  visible: boolean
  userId: string
  client: SupabaseClient
  exercise?: Exercise | null
  onClose: () => void
  onSaved: (ex: Exercise) => void
}

export function CustomExerciseSheet({ visible, userId, client, exercise, onClose, onSaved }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const editing = !!exercise?.id
  const { canCreate } = useCreateLimit()

  const [name, setName] = useState('')
  const [pattern, setPattern] = useState<MovementPattern>('push')
  const [equipment, setEquipment] = useState<Equipment[]>(['bodyweight'])
  const [metrics, setMetrics] = useState<MetricKey[]>(['weight', 'reps'])
  const [metricsTouched, setMetricsTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Re-seed whenever the sheet opens (create = defaults, edit = the row's values).
  useEffect(() => {
    if (!visible) return
    if (exercise) {
      setName(exercise.name)
      setPattern(exercise.movement_pattern)
      setEquipment(exercise.required_equipment?.length ? exercise.required_equipment : ['bodyweight'])
      setMetrics(exercise.tracking_metrics?.length ? exercise.tracking_metrics : ['weight', 'reps'])
      setNotes(exercise.notes ?? '')
      setMetricsTouched(true) // don't auto-rewrite an existing exercise's metrics
    } else {
      setName(''); setPattern('push'); setEquipment(['bodyweight']); setMetrics(['weight', 'reps']); setNotes('')
      setMetricsTouched(false)
    }
  }, [visible, exercise?.id])

  // Changing category nudges the tracked metrics to a sensible default — until the
  // user has explicitly chosen metrics themselves.
  const selectPattern = (p: MovementPattern) => {
    setPattern(p)
    if (!metricsTouched) setMetrics(defaultMetricsForCategory(p))
  }
  const toggleEquip = (id: Equipment) =>
    setEquipment((p) => (p.includes(id) ? p.filter((e) => e !== id) : [...p, id]))
  const toggleMetric = (id: MetricKey) => {
    setMetricsTouched(true)
    setMetrics((p) => (p.includes(id) ? p.filter((m) => m !== id) : [...p, id]))
  }

  const handleSave = async () => {
    if (saving) return
    if (!name.trim()) { Alert.alert('Name your exercise', 'Give your exercise a name first.'); return }
    if (metrics.length === 0) { Alert.alert('Pick a metric', 'Choose at least one thing to track (e.g. reps).'); return }
    setSaving(true)
    const input = {
      name, movement_pattern: pattern,
      category: EXERCISE_CATEGORIES.find((c) => c.id === pattern)?.label ?? null,
      notes, required_equipment: equipment, tracking_metrics: metrics,
    }
    try {
      if (editing && exercise) {
        const ok = await updateCustomExercise(client, exercise.id, input)
        if (!ok) throw new Error('update failed')
        onSaved({ ...exercise, ...input, primary_muscles: exercise.primary_muscles ?? [] } as Exercise)
      } else {
        // Free-tier cap: block a NEW custom exercise past the limit (routes to the
        // paywall). Inert while Pro is dormant. Editing an existing one is never gated.
        const count = await countCustomExercises(client, userId)
        if (!canCreate('custom_exercises', count)) { setSaving(false); return }
        const created = await createCustomExercise(client, userId, input)
        if (!created) throw new Error('create failed')
        onSaved(created)
      }
      onClose()
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    // `scroll`: single top-level BottomSheetScrollView (see AddWorkoutSheet for why
    // a nested one inside a non-scroll TempoSheet leaves the "Create exercise"
    // button unreachable — gorhom's BottomSheetView has no bounded height for a
    // nested scroll view to scroll within).
    <TempoSheet visible={visible} onClose={onClose} snapPoints={['90%']} scroll>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
        <Text style={styles.title}>{editing ? 'Edit exercise' : 'New exercise'}</Text>
            <Text style={styles.label}>NAME</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Sled Push, Trail Run"
              placeholderTextColor={C.outline}
              maxLength={48}
              autoFocus={!editing}
            />

            <Text style={styles.label}>CATEGORY</Text>
            <View style={styles.chipWrap}>
              {EXERCISE_CATEGORIES.map((c) => {
                const on = pattern === c.id
                return (
                  <TouchableOpacity key={c.id} style={[styles.chip, on && styles.chipOn]} onPress={() => selectPattern(c.id)} activeOpacity={0.85}>
                    <Ionicons name={c.icon as any} size={14} color={on ? C.onPrimary : C.primary} />
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.label}>TRACK</Text>
            <View style={styles.chipWrap}>
              {METRIC_OPTIONS.map((m) => {
                const on = metrics.includes(m.id)
                return (
                  <TouchableOpacity key={m.id} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleMetric(m.id)} activeOpacity={0.85}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.label}>EQUIPMENT</Text>
            <View style={styles.chipWrap}>
              {EQUIPMENT.map((e) => {
                const on = equipment.includes(e.id)
                return (
                  <TouchableOpacity key={e.id} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleEquip(e.id)} activeOpacity={0.85}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{e.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.label}>NOTES / FORM CUES (OPTIONAL)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={notes}
              onChangeText={setNotes}
              placeholder="How to perform it, cues to remember…"
              placeholderTextColor={C.outline}
              multiline
              maxLength={400}
            />

        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color={C.onPrimary} /> : <Text style={styles.saveBtnText}>{editing ? 'Save changes' : 'Create exercise'}</Text>}
        </TouchableOpacity>
      </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: { padding: Spacing.lg, gap: Spacing.xs },
  title: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3, marginBottom: Spacing.xs },
  label: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.xs },
  input: { minHeight: 48, backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontFamily: 'Inter_500Medium', fontSize: 16, color: C.text },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text },
  chipTextOn: { color: C.onPrimary },
  saveBtn: { height: 54, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
