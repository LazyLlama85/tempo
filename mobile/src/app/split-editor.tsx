// Tempo — Split editor (modal).
//
// Author the user's overall weekly training schedule: name it, then for each weekday
// set a Rest day or a workout (assembled from the exercise library / a saved
// template). Saving optionally makes it the active schedule, which materializes the
// week onto the calendar (see lib/splitSchedule.activateSplit).

import { useCallback, useEffect, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, TextInput, Switch, Alert, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from 'react-native'
import { PulseLoader } from '@/components/brand'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { PressableScale } from '@/components/motion'
import { ExercisePickerSheet } from '@/components/ExercisePickerSheet'
import { OptionSheet } from '@/components/OptionSheet'
import {
  WEEKDAY_LABELS, dayFromDraftItems, dayToDraftItems, restDay, saveSplit, fetchSplits,
} from '@/lib/splits'
import { activateSplit } from '@/lib/splitSchedule'
import { describeSaveError } from '@/lib/saveErrors'
import { type DraftItem, makeDraftItem, fetchTemplates, templateToItems } from '@/lib/workoutBuilder'
import { SPLIT_PRESETS, applySplitPreset } from '@/lib/starterTemplates'
import type { Exercise, Split, WorkoutTemplate } from '@/types'

const FULL_WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

interface DayDraft { weekday: number; label: string; rest: boolean; items: DraftItem[] }

function freshDays(): DayDraft[] {
  return Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, label: 'Rest', rest: true, items: [] }))
}

export default function SplitEditorScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { session, profile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const { splitId } = useLocalSearchParams<{ splitId?: string }>()

  const [name, setName] = useState('')
  const [days, setDays] = useState<DayDraft[]>(freshDays)
  const [loading, setLoading] = useState(!!splitId)
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState<number | null>(null)  // index into days
  const [pickerOpen, setPickerOpen] = useState(false)

  // Hydrate an existing split for editing.
  useEffect(() => {
    if (!splitId || !userId) return
    ;(async () => {
      const all = await fetchSplits(supabase, userId)
      const s = all.find((x) => x.id === splitId)
      if (!s) { setLoading(false); return }
      setName(s.name)
      const hydrated: DayDraft[] = []
      for (let i = 0; i < 7; i++) {
        const d = s.days.find((x) => x.weekday === i + 1)
        if (!d || d.rest) { hydrated.push({ weekday: i + 1, label: 'Rest', rest: true, items: [] }); continue }
        hydrated.push({ weekday: i + 1, label: d.label, rest: false, items: await dayToDraftItems(supabase, d) })
      }
      setDays(hydrated)
      setLoading(false)
    })()
  }, [splitId, userId])

  const updateDay = useCallback((idx: number, patch: Partial<DayDraft>) => {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)))
  }, [])

  // Fill the whole week from a split template — and save each of its workouts into
  // the user's library so they're reusable everywhere.
  // A bottom sheet, not Alert.alert — Android caps alerts at 3 buttons, which
  // silently hid most presets.
  const [presetSheet, setPresetSheet] = useState(false)
  const applyPresetChoice = async (key: string) => {
    const p = SPLIT_PRESETS.find((x) => x.id === key)
    setPresetSheet(false)
    if (!p) return
    setLoading(true)
    try {
      const res = await applySplitPreset(supabase, userId, p)
      setName((n) => n.trim() || res.name)
      setDays(res.days.map((d) => ({
        weekday: d.weekday, label: d.label, rest: d.items.length === 0, items: d.items,
      })))
    } catch (err) {
      const info = describeSaveError(err, 'load this template')
      Alert.alert('Couldn’t load template', info.message)
    } finally {
      setLoading(false)
    }
  }

  const toggleRest = (idx: number, rest: boolean) => {
    updateDay(idx, rest
      ? { rest: true, label: 'Rest', items: [] }
      : { rest: false, label: days[idx].label === 'Rest' ? FULL_WEEKDAY[idx].slice(0, 3) + ' Workout' : days[idx].label })
  }

  const addExercise = (ex: Exercise) => {
    if (editing === null) return
    const cur = days[editing]
    if (cur.items.some((it) => it.exercise.id === ex.id)) return
    updateDay(editing, { items: [...cur.items, makeDraftItem(ex)] })
  }

  const removeExercise = (exId: string) => {
    if (editing === null) return
    updateDay(editing, { items: days[editing].items.filter((it) => it.exercise.id !== exId) })
  }

  const bumpSets = (exId: string, delta: number) => {
    if (editing === null) return
    updateDay(editing, {
      items: days[editing].items.map((it) =>
        it.exercise.id === exId ? { ...it, sets: Math.max(1, Math.min(8, it.sets + delta)) } : it),
    })
  }
  const bumpReps = (exId: string, delta: number) => {
    if (editing === null) return
    updateDay(editing, {
      items: days[editing].items.map((it) => {
        if (it.exercise.id !== exId) return it
        const reps = Math.max(1, Math.min(30, it.repHigh + delta))
        return { ...it, repLow: reps, repHigh: reps }
      }),
    })
  }

  // Pull a saved workout into the day being edited — a scrollable sheet, so every
  // template is reachable (an Alert menu capped the list and broke on Android).
  const [templateSheet, setTemplateSheet] = useState<WorkoutTemplate[] | null>(null)
  const fillFromTemplate = async () => {
    if (editing === null) return
    const templates = await fetchTemplates(supabase, userId)
    if (!templates.length) {
      Alert.alert('No saved workouts', 'Build and save a workout first (My Workouts → Build a new workout), then you can drop it into a day here.')
      return
    }
    setTemplateSheet(templates)
  }
  const applyTemplateChoice = async (id: string) => {
    const t = templateSheet?.find((x) => x.id === id)
    setTemplateSheet(null)
    if (!t || editing === null) return
    const items = await templateToItems(supabase, t)
    updateDay(editing, { label: t.name, rest: false, items })
  }

  const handleSave = async (thenActivate: boolean) => {
    if (saving) return
    if (!name.trim()) { Alert.alert('Name your split', 'Give your split a name (e.g. “Push Pull Legs”).'); return }
    const workDays = days.filter((d) => !d.rest && d.items.length > 0)
    if (workDays.length === 0) { Alert.alert('Add a workout', 'Set at least one training day with exercises.'); return }

    setSaving(true)
    const splitDays = days.map((d) =>
      d.rest || d.items.length === 0 ? restDay(d.weekday) : dayFromDraftItems(d.weekday, d.label, d.items))
    const id = await saveSplit(supabase, userId, { name, days: splitDays, splitId: splitId ?? null })
    if (!id) { setSaving(false); Alert.alert('Could not save', 'Please try again.'); return }

    if (thenActivate) {
      const split: Split = {
        id, user_id: userId, name: name.trim(), is_active: true, days: splitDays,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      const result = await activateSplit(supabase, userId, split, profile)
      if (result === 'failed') {
        // The split IS saved — only activation failed. Say so instead of leaving
        // the user thinking their schedule switched when it didn't.
        setSaving(false)
        Alert.alert('Saved, but not activated', 'Your split was saved. Activating it didn’t go through — open My Splits and set it active to try again.', [
          { text: 'OK', onPress: () => router.back() },
        ])
        return
      }
      if (result === 'activated_pending') {
        // Active, but this week's sessions couldn't be written (likely offline) —
        // they self-materialize on the next online app open, so don't say "retry".
        setSaving(false)
        Alert.alert('Activated', 'Your split is now your schedule. Tempo couldn’t reach the server to build this week’s sessions — they’ll appear next time you open the app online.', [
          { text: 'OK', onPress: () => router.back() },
        ])
        return
      }
    }
    setSaving(false)
    router.back()
  }

  const confirmSave = () => {
    Alert.alert('Save split', 'Make this your active schedule now?', [
      { text: 'Save only', onPress: () => handleSave(false) },
      { text: 'Activate', onPress: () => handleSave(true) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const openDay = editing !== null ? days[editing] : null

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}><Ionicons name="chevron-down" size={26} color={C.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>{splitId ? 'Edit Split' : 'New Split'}</Text>
        <TouchableOpacity onPress={confirmSave} disabled={saving} hitSlop={8}>
          {saving ? <ActivityIndicator color={C.primary} /> : <Text style={styles.save}>Save</Text>}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading your split…" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {!splitId && (
            <TouchableOpacity style={styles.templateBtn} onPress={() => setPresetSheet(true)} activeOpacity={0.85}>
              <Ionicons name="sparkles" size={16} color={C.primary} />
              <Text style={styles.templateBtnText}>Start from a template</Text>
              <Ionicons name="chevron-forward" size={15} color={C.outline} />
            </TouchableOpacity>
          )}

          <Text style={styles.fieldLabel}>SPLIT NAME</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Push Pull Legs"
            placeholderTextColor={C.outline}
            maxLength={40}
            returnKeyType="done"
          />

          <Text style={styles.fieldLabel}>YOUR WEEK</Text>
          <View style={styles.card}>
            {days.map((d, i) => (
              <View key={d.weekday}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableOpacity style={styles.dayRow} onPress={() => setEditing(i)} activeOpacity={0.7}>
                  <View style={styles.dayPill}><Text style={styles.dayPillText}>{WEEKDAY_LABELS[i]}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dayLabel, d.rest && { color: C.textSecondary }]} numberOfLines={1}>{d.rest ? 'Rest day' : d.label}</Text>
                    {!d.rest && (
                      <Text style={styles.daySub}>{d.items.length === 0 ? 'No exercises yet' : `${d.items.length} exercise${d.items.length === 1 ? '' : 's'}`}</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.outline} />
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <Text style={styles.hint}>Tap a day to set a workout or mark it a rest day. Activating the split lays this week onto your calendar and repeats it.</Text>
        </ScrollView>
      )}

      {/* Day editor */}
      <Modal visible={editing !== null} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setEditing(null)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
            <View style={styles.sheetHandle} />
            {openDay && editing !== null && (
              <>
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>{FULL_WEEKDAY[editing]}</Text>
                  <TouchableOpacity onPress={() => setEditing(null)} hitSlop={8}><Ionicons name="checkmark" size={24} color={C.primary} /></TouchableOpacity>
                </View>

                <View style={styles.restRow}>
                  <Text style={styles.restLabel}>Rest day</Text>
                  <Switch
                    value={openDay.rest}
                    onValueChange={(v) => toggleRest(editing, v)}
                    trackColor={{ true: C.primary, false: C.surfaceContainerHigh }}
                  />
                </View>

                {!openDay.rest && (
                  <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                    <Text style={styles.fieldLabel}>WORKOUT NAME</Text>
                    <TextInput
                      style={styles.input}
                      value={openDay.label}
                      onChangeText={(t) => updateDay(editing, { label: t })}
                      placeholder="e.g. Push"
                      placeholderTextColor={C.outline}
                      maxLength={32}
                    />

                    {openDay.items.map((it) => (
                      <View key={it.exercise.id} style={styles.exRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.exName} numberOfLines={1}>{it.exercise.name}</Text>
                          <View style={styles.stepperRow}>
                            <Stepper C={C} label="sets" value={it.sets} onMinus={() => bumpSets(it.exercise.id, -1)} onPlus={() => bumpSets(it.exercise.id, 1)} />
                            <Stepper C={C} label="reps" value={it.repHigh} onMinus={() => bumpReps(it.exercise.id, -1)} onPlus={() => bumpReps(it.exercise.id, 1)} />
                          </View>
                        </View>
                        <TouchableOpacity onPress={() => removeExercise(it.exercise.id)} hitSlop={8}>
                          <Ionicons name="close-circle" size={22} color={C.outline} />
                        </TouchableOpacity>
                      </View>
                    ))}

                    <PressableScale style={styles.addBtn} onPress={() => setPickerOpen(true)}>
                      <Ionicons name="add" size={18} color={C.primary} />
                      <Text style={styles.addBtnText}>Add exercise</Text>
                    </PressableScale>
                    <TouchableOpacity onPress={fillFromTemplate} hitSlop={6} style={{ alignSelf: 'center', paddingVertical: Spacing.xs }}>
                      <Text style={styles.link}>Use a saved workout</Text>
                    </TouchableOpacity>
                  </ScrollView>
                )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>

        <ExercisePickerSheet
          visible={pickerOpen}
          userId={userId}
          client={supabase}
          existingIds={openDay?.items.map((it) => it.exercise.id) ?? []}
          onClose={() => setPickerOpen(false)}
          onAdd={addExercise}
          onRemove={(ex) => removeExercise(ex.id)}
        />
      </Modal>

      <OptionSheet
        visible={presetSheet}
        title="Start from a template"
        subtitle="Pick a proven split. Its workouts are saved to your library so you can reuse them anywhere."
        options={SPLIT_PRESETS.map((p) => ({ key: p.id, label: p.name, sub: p.description, icon: 'repeat-outline' }))}
        onSelect={applyPresetChoice}
        onClose={() => setPresetSheet(false)}
      />

      <OptionSheet
        visible={templateSheet !== null}
        title="Use a saved workout"
        subtitle="Replace this day with one of your saved workouts."
        options={(templateSheet ?? []).map((t) => ({
          key: t.id,
          label: t.name,
          sub: `${t.exercise_ids.length} exercise${t.exercise_ids.length === 1 ? '' : 's'} · ~${t.est_duration_min} min`,
          icon: 'barbell-outline',
        }))}
        onSelect={applyTemplateChoice}
        onClose={() => setTemplateSheet(null)}
      />
    </SafeAreaView>
  )
}

function Stepper({ C, label, value, onMinus, onPlus }: { C: Palette; label: string; value: number; onMinus: () => void; onPlus: () => void }) {
  const s = stepperStyles(C)
  return (
    <View style={s.wrap}>
      <TouchableOpacity onPress={onMinus} hitSlop={6} style={s.btn}><Ionicons name="remove" size={16} color={C.text} /></TouchableOpacity>
      <Text style={s.value}>{value}</Text>
      <TouchableOpacity onPress={onPlus} hitSlop={6} style={s.btn}><Ionicons name="add" size={16} color={C.text} /></TouchableOpacity>
      <Text style={s.label}>{label}</Text>
    </View>
  )
}

const stepperStyles = (C: Palette) => StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  value: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, minWidth: 18, textAlign: 'center' },
  label: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.textSecondary, marginLeft: 1 },
})

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm },
  headerTitle: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
  save: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.primary },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.xs },
  fieldLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  input: {
    height: 52, backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md,
    fontFamily: 'Inter_500Medium', fontSize: 16, color: C.text, marginTop: Spacing.xs,
  },
  templateBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: C.primarySoft, marginTop: Spacing.sm },
  templateBtnText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  card: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden', marginTop: Spacing.xs, ...CardShadow },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: 64 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  dayPill: { width: 40, height: 28, borderRadius: Radius.full, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  dayPillText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary },
  dayLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  daySub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19, marginTop: Spacing.md },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.xs, maxHeight: '90%' },
  sheetHandle: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: C.outlineVariant, alignSelf: 'center', marginBottom: Spacing.xs },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  restRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  restLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  exRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh },
  exName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  stepperRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: 6 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm, marginTop: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.primary, backgroundColor: C.surfaceContainerLow },
  addBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },
  link: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
})
