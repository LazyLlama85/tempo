// Tempo — Split editor (modal).
//
// Author the user's overall weekly training schedule: name it, then for each weekday
// set a Rest day or a workout (assembled from the exercise library / a saved
// template). Saving optionally makes it the active schedule, which materializes the
// week onto the calendar (see lib/splitSchedule.activateSplit).

import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, TextInput, Switch, Alert, ActivityIndicator, Modal, KeyboardAvoidingView, LayoutAnimation, Platform } from 'react-native'
import { PulseLoader } from '@/components/brand'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { PressableScale, useReducedMotion } from '@/components/motion'
import { ExercisePickerSheet } from '@/components/ExercisePickerSheet'
import { OptionSheet } from '@/components/OptionSheet'
import {
  WEEKDAY_LABELS, dayFromDraftItems, daysToDraftItems, restDay, saveSplit, fetchSplits,
} from '@/lib/splits'
import { activateSplit } from '@/lib/splitSchedule'
import { describeSaveError } from '@/lib/saveErrors'
import { consumeSplitHandoff } from '@/lib/handoff'
import * as haptics from '@/lib/haptics'
import { type DraftItem, makeDraftItem, fetchTemplates, templateToItems, estimateDurationMin } from '@/lib/workoutBuilder'
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
  const reduceMotion = useReducedMotion()
  // Whether the split being edited is the currently-active schedule — if so,
  // saving must restamp its already-materialized future sessions.
  const [wasActive, setWasActive] = useState(false)

  // Saved workouts, prefetched so the "Use a saved workout" picker opens instantly
  // (it used to fetch on tap with no spinner — the button felt dead) and refreshed
  // on every focus so a workout saved seconds ago is immediately assignable.
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([])
  // The day awaiting a workout created in the workout builder (see handoff lib).
  const pendingDayRef = useRef<number | null>(null)

  const animateNext = useCallback(() => {
    if (reduceMotion) return
    LayoutAnimation.configureNext(
      LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
    )
  }, [reduceMotion])

  // Hydrate an existing split for editing — one batched exercises query for the
  // whole week (the per-day loop made 7 sequential round-trips).
  useEffect(() => {
    if (!splitId || !userId) return
    ;(async () => {
      try {
        const all = await fetchSplits(supabase, userId)
        const s = all.find((x) => x.id === splitId)
        if (!s) return
        setName(s.name)
        setWasActive(s.is_active)
        const itemsByWeekday = await daysToDraftItems(supabase, s.days.filter((d) => !d.rest))
        setDays(Array.from({ length: 7 }, (_, i) => {
          const d = s.days.find((x) => x.weekday === i + 1)
          if (!d || d.rest) return { weekday: i + 1, label: 'Rest', rest: true, items: [] }
          return { weekday: i + 1, label: d.label, rest: false, items: itemsByWeekday.get(d.weekday) ?? [] }
        }))
      } finally {
        setLoading(false)
      }
    })()
  }, [splitId, userId])

  // Keep the saved-workout list warm, and complete the "create a workout for this
  // day" round-trip: when the workout builder saves a template it was asked to
  // create for a split day, assign it to that day and reopen the day editor.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return
      fetchTemplates(supabase, userId).then(setTemplates).catch(() => {})
      const createdId = consumeSplitHandoff()
      const dayIdx = pendingDayRef.current
      if (!createdId || dayIdx === null) return
      pendingDayRef.current = null
      ;(async () => {
        const { data } = await supabase.from('workout_templates').select('*').eq('id', createdId).maybeSingle()
        if (!data) return
        const t = data as WorkoutTemplate
        const items = await templateToItems(supabase, t)
        animateNext()
        setDays((prev) => prev.map((d, i) => (i === dayIdx ? { ...d, label: t.name, rest: false, items } : d)))
        setTemplates((prev) => (prev.some((x) => x.id === t.id) ? prev : [t, ...prev]))
        setEditing(dayIdx)
      })()
    }, [userId, animateNext]),
  )

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
    animateNext()
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
  // IMPORTANT: the sheet is rendered INSIDE the day-editor Modal below. As a
  // sibling Modal it silently failed to present over the open day editor on iOS —
  // "Use a saved workout" looked broken and could strand an invisible backdrop
  // that ate every touch (the "editor freezes after editing a day" bug).
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false)
  const fillFromTemplate = () => {
    if (editing === null) return
    setTemplateSheetOpen(true)
  }

  // Create a brand-new workout for this day: remember the day, hop to the workout
  // builder, and let the focus effect above auto-assign the result on return —
  // the user never has to find the workout again by hand.
  const createWorkoutForDay = () => {
    if (editing === null) return
    pendingDayRef.current = editing
    setEditing(null)
    setTemplateSheetOpen(false)
    router.push('/workout-builder?forSplit=1' as any)
  }

  const applyTemplateChoice = async (id: string) => {
    setTemplateSheetOpen(false)
    if (id === '__create') { createWorkoutForDay(); return }
    const t = templates.find((x) => x.id === id)
    if (!t || editing === null) return
    const items = await templateToItems(supabase, t)
    animateNext()
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

    // Editing the ACTIVE split? Its future sessions are already on the calendar
    // with the OLD exercises — re-activating retires those and re-materializes
    // from the edited days, so the change actually reaches the schedule. (Without
    // this, edits to an active split silently only affected the split row.)
    const mustRestamp = thenActivate || wasActive
    if (mustRestamp) {
      const split: Split = {
        id, user_id: userId, name: name.trim(), is_active: true, days: splitDays,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      const result = await activateSplit(supabase, userId, split, profile)
      if (result === 'failed') {
        // The split IS saved — only (re)activation failed. Say so instead of
        // leaving the user thinking their schedule updated when it didn't.
        setSaving(false)
        Alert.alert('Saved, but schedule not updated', 'Your split was saved, but updating this week’s sessions didn’t go through. Open My Splits and set it active to try again.', [
          { text: 'OK', onPress: () => router.back() },
        ])
        return
      }
      if (result === 'activated_pending') {
        // Active, but this week's sessions couldn't be written (likely offline) —
        // they self-materialize on the next online app open, so don't say "retry".
        setSaving(false)
        Alert.alert(wasActive ? 'Saved' : 'Activated', 'Your split is your schedule. Tempo couldn’t reach the server to rebuild this week’s sessions — they’ll update next time you open the app online.', [
          { text: 'OK', onPress: () => router.back() },
        ])
        return
      }
    }
    haptics.success()
    setSaving(false)
    router.back()
  }

  const confirmSave = () => {
    // Editing the active split: no "make active?" question — it already is, and
    // we always restamp its sessions. New/inactive split: offer to activate.
    if (wasActive) { handleSave(false); return }
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
                  <View style={[styles.dayPill, !d.rest && d.items.length > 0 && styles.dayPillOn]}>
                    <Text style={[styles.dayPillText, !d.rest && d.items.length > 0 && styles.dayPillTextOn]}>{WEEKDAY_LABELS[i]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dayLabel, d.rest && { color: C.textSecondary }]} numberOfLines={1}>{d.rest ? 'Rest day' : d.label}</Text>
                    {!d.rest && (
                      <Text style={styles.daySub}>
                        {d.items.length === 0
                          ? 'No exercises yet — tap to add'
                          : `${d.items.length} exercise${d.items.length === 1 ? '' : 's'} · ~${estimateDurationMin(d.items)} min`}
                      </Text>
                    )}
                  </View>
                  {d.rest ? (
                    <View style={styles.restBadge}>
                      <Ionicons name="moon-outline" size={11} color={C.textSecondary} />
                      <Text style={styles.restBadgeText}>REST</Text>
                    </View>
                  ) : d.items.length > 0 ? (
                    <Ionicons name="checkmark-circle" size={18} color={C.success} />
                  ) : (
                    <Ionicons name="add-circle-outline" size={18} color={C.primary} />
                  )}
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

                    {openDay.items.length === 0 && (
                      <View style={styles.fillRow}>
                        <PressableScale style={styles.fillBtn} onPress={fillFromTemplate}>
                          <Ionicons name="albums-outline" size={20} color={C.primary} />
                          <Text style={styles.fillBtnLabel}>Saved workout</Text>
                          <Text style={styles.fillBtnSub}>Pick one you built</Text>
                        </PressableScale>
                        <PressableScale style={styles.fillBtn} onPress={createWorkoutForDay}>
                          <Ionicons name="add-circle-outline" size={20} color={C.primary} />
                          <Text style={styles.fillBtnLabel}>New workout</Text>
                          <Text style={styles.fillBtnSub}>Build one for this day</Text>
                        </PressableScale>
                      </View>
                    )}

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
                    {openDay.items.length > 0 && (
                      <TouchableOpacity onPress={fillFromTemplate} hitSlop={6} style={{ alignSelf: 'center', paddingVertical: Spacing.xs }}>
                        <Text style={styles.link}>Replace with a saved workout</Text>
                      </TouchableOpacity>
                    )}
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

        {/* Nested inside the day-editor Modal so it can actually present over it on
            iOS (a sibling Modal cannot — see fillFromTemplate). */}
        <OptionSheet
          visible={templateSheetOpen}
          title="Use a saved workout"
          subtitle="Set this day to one of your saved workouts, or build a new one."
          options={[
            ...templates.map((t) => ({
              key: t.id,
              label: t.name,
              sub: `${t.exercise_ids.length} exercise${t.exercise_ids.length === 1 ? '' : 's'} · ~${t.est_duration_min} min`,
              icon: 'barbell-outline',
            })),
            { key: '__create', label: 'Create a new workout', sub: 'Build it now — it comes right back to this day', icon: 'add-circle-outline' },
          ]}
          onSelect={applyTemplateChoice}
          onClose={() => setTemplateSheetOpen(false)}
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
  dayPillOn: { backgroundColor: C.primarySoft },
  dayPillTextOn: { color: C.primary },
  restBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  restBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.textSecondary, letterSpacing: 0.5 },
  fillRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  fillBtn: {
    flex: 1, alignItems: 'center', gap: 3, paddingVertical: Spacing.md,
    borderRadius: Radius.lg, backgroundColor: C.primarySoft,
  },
  fillBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },
  fillBtnSub: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: C.textSecondary },
})
