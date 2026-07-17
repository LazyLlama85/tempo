// Tempo — onboarding preferred-time + off-days step (2026-07-17 restructure).
//
// Last of the split-up availability screens (Sleep → Work/School → here). Does
// the actual user_profiles upsert — same responsibility the old single
// availability.tsx screen had — since it's now the step with all the pieces
// (wake/bed from Sleep, work/school from Work-School, tod/off-days from here).

import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark } from '@/components/brand'
import { PressableScale } from '@/components/motion'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { track } from '@/lib/analytics'
import { describeSaveError, isAuthError } from '@/lib/saveErrors'
import type { TimeOfDay, UnavailableBlock, Equipment } from '@/types'

const genId = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`
const TOTAL_STEPS = 6

const DAYS: { iso: number; label: string }[] = [
  { iso: 1, label: 'Mon' }, { iso: 2, label: 'Tue' }, { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' }, { iso: 5, label: 'Fri' }, { iso: 6, label: 'Sat' }, { iso: 7, label: 'Sun' },
]

const TODS: { id: TimeOfDay; label: string }[] = [
  { id: 'morning', label: 'Morning' }, { id: 'afternoon', label: 'Afternoon' }, { id: 'evening', label: 'Evening' },
]

export default function OnboardingTrainTimeScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session, profile, refreshProfile } = useAuthStore()
  const params = useLocalSearchParams<{
    goal: string; experience: string; equipment: string; daysPerWeek: string; schedulingMode?: string; sessionMinutes?: string; buildMode?: string
    includeCardio?: string; wake?: string; bed?: string; workSchoolStart?: string; workSchoolEnd?: string
  }>()

  const [tod, setTod] = useState<TimeOfDay | null>(profile?.preferred_time_of_day ?? null)
  const [offDays, setOffDays] = useState<number[]>(() =>
    ((profile?.unavailable_blocks ?? []) as UnavailableBlock[])
      .filter((b) => b.scope === 'weekday' && b.allDay && b.weekday != null)
      .map((b) => b.weekday as number)
      .sort((a, b) => a - b),
  )
  const [saving, setSaving] = useState(false)

  const toggleOff = (iso: number) =>
    setOffDays(prev => prev.includes(iso) ? prev.filter(d => d !== iso) : [...prev, iso].sort((a, b) => a - b))

  const goNext = () => {
    track('onboarding_step_completed', { step: 'train_time' })
    router.push({ pathname: '/onboarding/plan-preview', params })
  }

  const handleContinue = async (attempt = 0) => {
    if (attempt === 0 && saving) return
    if (!session) { goNext(); return }
    setSaving(true)
    // Each "never train" day becomes a recurring all-day unavailable block, so the
    // scheduler treats it exactly like the ones added later in Settings. Blocks of
    // other kinds (dated one-offs, timed windows added in Settings) are preserved —
    // only the weekday-all-day set is rebuilt from the chips above.
    const kept = ((profile?.unavailable_blocks ?? []) as UnavailableBlock[])
      .filter((b) => !(b.scope === 'weekday' && b.allDay))
    const unavailable: UnavailableBlock[] = [
      ...kept,
      ...offDays.map(wd => ({ id: genId(), scope: 'weekday' as const, weekday: wd, allDay: true })),
    ]
    const workSchoolStart = params.workSchoolStart || null
    const workSchoolEnd = params.workSchoolEnd || null
    try {
      // Include the required (NOT NULL) profile fields from onboarding params — this
      // is the FIRST write to user_profiles, so the row doesn't exist yet. Without
      // goal/experience/days_per_week the insert violates NOT NULL and silently drops
      // all availability. plan-preview later re-upserts the same row to add
      // onboarding_complete. Work/School is one merged onboarding question but writes
      // into BOTH fields (see work-school.tsx's header comment) so every existing
      // consumer of either field keeps working unchanged.
      const { error } = await supabase.from('user_profiles').upsert({
        user_id: session.user.id,
        goal: params.goal,
        experience: params.experience,
        equipment: (params.equipment ?? '').split(',').filter(Boolean) as Equipment[],
        days_per_week: parseInt(params.daysPerWeek ?? '3', 10) || 3,
        preferred_duration_min: params.sessionMinutes ? parseInt(params.sessionMinutes, 10) : 45,
        include_cardio: params.includeCardio === 'true',
        wake_time: params.wake || null,
        bedtime: params.bed || null,
        work_start: workSchoolStart,
        work_end: workSchoolEnd,
        school_start: workSchoolStart,
        school_end: workSchoolEnd,
        preferred_time_of_day: tod,
        unavailable_blocks: unavailable,
        scheduling_mode: params.schedulingMode === 'manual' ? 'manual' : 'auto',
      })
      if (error) throw error
      await refreshProfile().catch(() => {})
      setSaving(false)
      goNext()
    } catch (err) {
      // An expired session refreshes in one call — do that and retry silently once
      // before involving the user (mirrors plan-preview).
      if (attempt === 0 && isAuthError(err)) {
        try {
          await supabase.auth.refreshSession()
          return handleContinue(1)
        } catch { /* fall through to the alert */ }
      }
      setSaving(false)
      // Don't trap the user at onboarding over an availability save — they can set
      // this any time from Profile → Settings → Availability. But say WHY it failed
      // and offer a real retry, since "continue" quietly drops their choices for this pass.
      const info = describeSaveError(err, 'save your availability')
      Alert.alert(info.title, `${info.message}\n\nYou can also continue and set this later in Settings.`, [
        { text: 'Try Again', onPress: () => handleContinue() },
        { text: 'Continue anyway', style: 'cancel', onPress: goNext },
      ])
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back" disabled={saving}>
          <Ionicons name="arrow-back" size={22} color={saving ? C.outlineVariant : C.text} />
        </TouchableOpacity>
        <TempoWordmark size={16} />
        <TouchableOpacity onPress={goNext} disabled={saving} hitSlop={8}>
          <Text style={[styles.skipTop, saving && { opacity: 0.4 }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(5 / TOTAL_STEPS) * 100}%` }]} />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 5 OF {TOTAL_STEPS}</Text>
        <Text style={styles.title}>When do you want to train?</Text>
        <Text style={styles.subtitle}>Tempo aims for this window consistently, and never schedules a day you rule out.</Text>

        <Text style={styles.sectionLabel}>PREFERRED TIME TO TRAIN</Text>
        <View style={styles.segmented}>
          {TODS.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[styles.segment, tod === t.id && styles.segmentActive]}
              onPress={() => setTod(tod === t.id ? null : t.id)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Train in the ${t.label.toLowerCase()}`}
              accessibilityState={{ selected: tod === t.id }}
            >
              <Text style={[styles.segmentText, tod === t.id && styles.segmentTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>DAYS I NEVER TRAIN</Text>
        <View style={styles.daysRow}>
          {DAYS.map(d => {
            const on = offDays.includes(d.iso)
            return (
              <TouchableOpacity
                key={d.iso}
                style={[styles.dayChip, on && styles.dayChipOn]}
                onPress={() => toggleOff(d.iso)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Never train on ${d.label}`}
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{d.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
        <Text style={styles.hint}>
          A standing commitment, or any day you simply rest — Tempo never schedules a
          workout here. Add specific times later in Settings.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <PressableScale
          style={[styles.continueBtn, saving && { opacity: 0.6 }]}
          onPress={() => handleContinue()}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color={C.onPrimary} /> : <Text style={styles.continueBtnText}>Continue</Text>}
        </PressableScale>
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  skipTop: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.textSecondary },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.lg },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.sm },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22, marginBottom: Spacing.xs },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 2 },
  segmented: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: 4, gap: 4 },
  segment: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center' },
  segmentActive: {
    backgroundColor: C.background, shadowColor: C.text, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  segmentText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  segmentTextActive: { fontFamily: 'Inter_700Bold', color: C.text },
  daysRow: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  dayChip: {
    flex: 1, aspectRatio: 1, borderRadius: Radius.md, borderWidth: 1.5, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  dayChipOn: { backgroundColor: C.primary, borderColor: C.primary },
  dayChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary },
  dayChipTextOn: { color: C.onPrimary },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
