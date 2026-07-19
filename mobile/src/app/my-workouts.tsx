// Tempo — My Workouts (modal).
//
// Manage saved workout templates (schedule / edit / duplicate / delete) and custom
// exercises (edit / delete). Entry point for the whole user-created-workout feature.

import { useCallback, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert, Share } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBanner } from '@/components/ErrorBanner'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { fetchTemplates, deleteTemplate, duplicateTemplate } from '@/lib/workoutBuilder'
import { createWorkoutShare, shareUrl } from '@/lib/social'
import { fetchCustomExercises, deleteCustomExercise } from '@/lib/customExercises'
import { CustomExerciseSheet } from '@/components/CustomExerciseSheet'
import { OptionSheet } from '@/components/OptionSheet'
import { PressableScale } from '@/components/motion'
import type { WorkoutTemplate, Exercise } from '@/types'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function MyWorkoutsScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session, profile } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [templates, setTemplates] = useState<WorkoutTemplate[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [editEx, setEditEx] = useState<Exercise | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const load = useCallback(() => {
    if (!userId) return
    setLoadError(false)
    Promise.all([fetchTemplates(supabase, userId), fetchCustomExercises(supabase, userId)])
      .then(([t, e]) => { setTemplates(t); setExercises(e) })
      // A failed fetch used to leave templates/exercises at their initial []
      // — indistinguishable from "you haven't created anything yet."
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [userId])
  useFocusEffect(load)

  // Template actions in a bottom sheet, not Alert.alert — Android caps alerts at
  // 3 buttons, which made Duplicate/Delete unreachable there.
  const [sheetTemplate, setSheetTemplate] = useState<WorkoutTemplate | null>(null)
  const onTemplateAction = async (key: string) => {
    const t = sheetTemplate
    setSheetTemplate(null)
    if (!t) return
    if (key === 'edit') router.push(`/workout-builder?templateId=${t.id}` as any)
    else if (key === 'schedule') router.push(`/workout-builder?templateId=${t.id}&date=${todayStr()}` as any)
    else if (key === 'duplicate') { await duplicateTemplate(supabase, userId, t); load() }
    else if (key === 'share') shareTemplate(t)
    else if (key === 'delete') confirmDeleteTemplate(t)
  }

  // Share = snapshot the template under a short code, then hand the link to the
  // system share sheet. Recipients open it via the link or paste the code into
  // Friends → "Got a shared workout?".
  const shareTemplate = async (t: WorkoutTemplate) => {
    const share = await createWorkoutShare(supabase, userId, profile?.display_name ?? null, t)
    if (!share) { Alert.alert('Couldn’t create link', 'Check your connection and try again.'); return }
    Share.share({
      message: `Try my "${t.name}" workout on Tempo: ${shareUrl(share.code)}\n\nOr paste this code in Tempo → Friends: ${share.code}`,
    }).catch(() => {})
  }
  const confirmDeleteTemplate = (t: WorkoutTemplate) =>
    Alert.alert('Delete workout?', `“${t.name}” will be removed. Already-scheduled sessions stay on your calendar.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { if (await deleteTemplate(supabase, t.id)) load() } },
    ])

  const exerciseActions = (e: Exercise) => {
    Alert.alert(e.name, e.category ?? 'Custom exercise', [
      { text: 'Edit', onPress: () => { setEditEx(e); setEditOpen(true) } },
      { text: 'Delete', style: 'destructive', onPress: () => confirmDeleteExercise(e) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }
  const confirmDeleteExercise = (e: Exercise) =>
    Alert.alert('Delete exercise?', `“${e.name}” will be removed from your library.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const res = await deleteCustomExercise(supabase, e.id)
          if (res.ok) load()
          else if (res.reason === 'has_history') Alert.alert('Can’t delete', 'This exercise has logged history, so it’s kept to preserve your records. You can edit it instead.')
          else Alert.alert('Could not delete', 'Please try again.')
        },
      },
    ])

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="My Workouts"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading your workouts…" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {loadError && (
            <ErrorBanner message="Couldn't load your workouts. What's shown may be incomplete." onRetry={load} />
          )}

          <PressableScale style={styles.bigBtn} onPress={() => router.push('/workout-builder' as any)}>
            <Ionicons name="add" size={20} color={C.onPrimary} />
            <Text style={styles.bigBtnText}>Build a new workout</Text>
          </PressableScale>

          {/* Splits — the program layer */}
          <Text style={styles.sectionLabel}>MY SPLITS</Text>
          <TouchableOpacity style={styles.navRow} onPress={() => router.push('/my-splits' as any)} activeOpacity={0.7}>
            <View style={styles.rowIcon}><Ionicons name="repeat-outline" size={18} color={C.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>My Splits</Text>
              <Text style={styles.rowMeta}>Build a weekly schedule — PPL, Upper/Lower, custom</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.outline} />
          </TouchableOpacity>

          {/* Templates */}
          <Text style={styles.sectionLabel}>SAVED WORKOUTS</Text>
          {templates.length === 0 ? (
            <EmptyState kind="barbell" title="No saved workouts yet" body="Build one and save it as a template to reuse and schedule it anytime." />
          ) : (
            <View style={styles.card}>
              {templates.map((t, i) => (
                <View key={t.id}>
                  {i > 0 && <View style={styles.divider} />}
                  <TouchableOpacity style={styles.row} onPress={() => setSheetTemplate(t)} activeOpacity={0.7}>
                    <View style={styles.rowIcon}><Ionicons name="barbell-outline" size={18} color={C.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{t.name}</Text>
                      <Text style={styles.rowMeta}>{t.exercise_ids.length} exercise{t.exercise_ids.length === 1 ? '' : 's'} · ~{t.est_duration_min} min</Text>
                    </View>
                    <Ionicons name="ellipsis-horizontal" size={18} color={C.outline} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Custom exercises */}
          <View style={styles.rowBetween}>
            <Text style={styles.sectionLabel}>MY EXERCISES</Text>
            <TouchableOpacity onPress={() => { setEditEx(null); setEditOpen(true) }} hitSlop={6}><Text style={styles.link}>New</Text></TouchableOpacity>
          </View>
          {exercises.length === 0 ? (
            <EmptyState kind="flash" title="No custom exercises yet" body="Create exercises for anything not in the library — they work everywhere built-ins do." />
          ) : (
            <View style={styles.card}>
              {exercises.map((e, i) => (
                <View key={e.id}>
                  {i > 0 && <View style={styles.divider} />}
                  <TouchableOpacity style={styles.row} onPress={() => exerciseActions(e)} activeOpacity={0.7}>
                    <View style={styles.rowIcon}><Ionicons name="fitness-outline" size={18} color={C.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{e.name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>{e.category ?? e.movement_pattern}{e.tracking_metrics?.length ? ` · ${e.tracking_metrics.join(', ')}` : ''}</Text>
                    </View>
                    <Ionicons name="ellipsis-horizontal" size={18} color={C.outline} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <CustomExerciseSheet
        visible={editOpen}
        userId={userId}
        client={supabase}
        exercise={editEx}
        onClose={() => setEditOpen(false)}
        onSaved={() => { setEditOpen(false); load() }}
      />

      <OptionSheet
        visible={sheetTemplate !== null}
        title={sheetTemplate?.name ?? ''}
        subtitle={sheetTemplate
          ? `${sheetTemplate.exercise_ids.length} exercise${sheetTemplate.exercise_ids.length === 1 ? '' : 's'} · ~${sheetTemplate.est_duration_min} min`
          : undefined}
        options={[
          { key: 'schedule', label: 'Add to calendar', sub: 'Schedule it onto a day', icon: 'calendar-outline' },
          { key: 'edit', label: 'Edit workout', icon: 'create-outline' },
          { key: 'share', label: 'Share', sub: 'Send a link — friends can save their own copy', icon: 'share-outline' },
          { key: 'duplicate', label: 'Duplicate', icon: 'copy-outline' },
          { key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true },
        ]}
        onSelect={onTemplateAction}
        onClose={() => setSheetTemplate(null)}
      />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm },
  headerTitle: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.sm },
  bigBtn: { height: 54, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: C.primary, marginTop: Spacing.xs },
  bigBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md },
  link: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19, paddingVertical: Spacing.xs },
  card: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden', ...CardShadow },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow },
  rowIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  rowMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, textTransform: 'capitalize', marginTop: 1 },
})
