// Tempo — onboarding availability step.
//
// Captured BEFORE the plan is generated so the very first schedule already lands in
// real openings: sleep window, work hours, school hours, preferred time of day, and
// any days the user is completely unavailable (e.g. Shabbat). Everything here is
// optional — "Skip" keeps sensible defaults — and fully editable later from the
// Profile → Availability screen. We upsert so the row is guaranteed to exist before
// plan-preview adds the goal/experience and flips onboarding_complete.

import { useState } from 'react'
import {
  StyleSheet, TouchableOpacity, View, Text, ScrollView, Switch, ActivityIndicator, Alert,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { TimePickerSheet, formatTime12 } from '@/components/TimePickerSheet'
import type { TimeOfDay, UnavailableBlock, Equipment } from '@/types'

const C = Colors.light

const genId = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`

const DAYS: { iso: number; label: string }[] = [
  { iso: 1, label: 'Mon' }, { iso: 2, label: 'Tue' }, { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' }, { iso: 5, label: 'Fri' }, { iso: 6, label: 'Sat' }, { iso: 7, label: 'Sun' },
]

const TODS: { id: TimeOfDay; label: string }[] = [
  { id: 'morning', label: 'Morning' }, { id: 'afternoon', label: 'Afternoon' }, { id: 'evening', label: 'Evening' },
]

type PickerField = 'wake' | 'bed' | 'workStart' | 'workEnd' | 'schoolStart' | 'schoolEnd'

export default function OnboardingAvailabilityScreen() {
  const router = useRouter()
  const { session, refreshProfile } = useAuthStore()
  const params = useLocalSearchParams<{
    goal: string; experience: string; equipment: string; daysPerWeek: string; preferredCalendar?: string
  }>()

  const [wake, setWake] = useState<string | null>('06:30:00')
  const [bed, setBed] = useState<string | null>('22:30:00')
  const [workStart, setWorkStart] = useState<string | null>(null)
  const [workEnd, setWorkEnd] = useState<string | null>(null)
  const [schoolStart, setSchoolStart] = useState<string | null>(null)
  const [schoolEnd, setSchoolEnd] = useState<string | null>(null)
  const [tod, setTod] = useState<TimeOfDay | null>(null)
  const [offDays, setOffDays] = useState<number[]>([])

  const [picker, setPicker] = useState<PickerField | null>(null)
  const [saving, setSaving] = useState(false)

  const workOn = workStart != null && workEnd != null
  const schoolOn = schoolStart != null && schoolEnd != null

  const toggleWork = (on: boolean) => {
    if (on) { setWorkStart('09:00:00'); setWorkEnd('17:00:00') }
    else { setWorkStart(null); setWorkEnd(null) }
  }
  const toggleSchool = (on: boolean) => {
    if (on) { setSchoolStart('08:00:00'); setSchoolEnd('15:00:00') }
    else { setSchoolStart(null); setSchoolEnd(null) }
  }
  const toggleOff = (iso: number) =>
    setOffDays(prev => prev.includes(iso) ? prev.filter(d => d !== iso) : [...prev, iso].sort((a, b) => a - b))

  const pickerValue = (): string | null => {
    switch (picker) {
      case 'wake': return wake
      case 'bed': return bed
      case 'workStart': return workStart
      case 'workEnd': return workEnd
      case 'schoolStart': return schoolStart
      case 'schoolEnd': return schoolEnd
      default: return null
    }
  }
  const applyPicker = (v: string) => {
    switch (picker) {
      case 'wake': setWake(v); break
      case 'bed': setBed(v); break
      case 'workStart': setWorkStart(v); break
      case 'workEnd': setWorkEnd(v); break
      case 'schoolStart': setSchoolStart(v); break
      case 'schoolEnd': setSchoolEnd(v); break
    }
    setPicker(null)
  }
  const pickerTitle: Record<PickerField, string> = {
    wake: 'Wake-up time', bed: 'Bedtime',
    workStart: 'Work starts', workEnd: 'Work ends',
    schoolStart: 'School starts', schoolEnd: 'School ends',
  }

  // Pass the onboarding choices straight through to the plan step.
  const goNext = () => router.push({ pathname: '/onboarding/plan-preview', params })

  const handleContinue = async () => {
    if (saving) return
    if (!session) { goNext(); return }
    setSaving(true)
    // Each "never train" day becomes a recurring all-day unavailable block, so the
    // scheduler treats it exactly like the ones added later in Settings.
    const unavailable: UnavailableBlock[] = offDays.map(wd => ({
      id: genId(), scope: 'weekday', weekday: wd, allDay: true,
    }))
    try {
      // Include the required (NOT NULL) profile fields from the onboarding params —
      // this is the FIRST write to user_profiles, so the row doesn't exist yet. Without
      // goal/experience/days_per_week the insert violates NOT NULL and silently drops
      // all availability (this was happening for every new user). plan-preview later
      // re-upserts the same row to add onboarding_complete.
      const { error } = await supabase.from('user_profiles').upsert({
        user_id: session.user.id,
        goal: params.goal,
        experience: params.experience,
        equipment: (params.equipment ?? '').split(',').filter(Boolean) as Equipment[],
        days_per_week: parseInt(params.daysPerWeek ?? '3', 10) || 3,
        wake_time: wake,
        bedtime: bed,
        work_start: workStart,
        work_end: workEnd,
        school_start: schoolStart,
        school_end: schoolEnd,
        preferred_time_of_day: tod,
        unavailable_blocks: unavailable,
      })
      if (error) throw error
      await refreshProfile()
      goNext()
    } catch {
      // Don't trap the user at onboarding over an availability save — they can set
      // this any time from Profile → Availability.
      Alert.alert('Couldn’t save just now', 'You can set this later in Settings.', [
        { text: 'Continue', onPress: goNext },
      ])
    } finally {
      setSaving(false)
    }
  }

  const TimeRow = ({ label, value, field }: { label: string; value: string | null; field: PickerField }) => (
    <TouchableOpacity style={styles.timeRow} onPress={() => setPicker(field)} activeOpacity={0.7}>
      <Text style={styles.timeRowLabel}>{label}</Text>
      <View style={styles.timeRowRight}>
        <Text style={styles.timeRowValue}>{formatTime12(value)}</Text>
        <Ionicons name="chevron-forward" size={16} color={C.outline} />
      </View>
    </TouchableOpacity>
  )

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} disabled={saving}>
          <Ionicons name="arrow-back" size={22} color={saving ? C.outlineVariant : C.text} />
        </TouchableOpacity>
        <Text style={styles.logo}>TEMPO</Text>
        <TouchableOpacity onPress={goNext} disabled={saving} hitSlop={8}>
          <Text style={[styles.skipTop, saving && { opacity: 0.4 }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: '83%' }]} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 5 OF 6</Text>
        <Text style={styles.title}>When does life happen?</Text>
        <Text style={styles.subtitle}>
          Tell Tempo your real hours and it'll slot workouts into the gaps — never on top
          of sleep, work, or class. You can change all of this later.
        </Text>

        {/* Sleep */}
        <Text style={styles.sectionLabel}>SLEEP</Text>
        <View style={styles.card}>
          <TimeRow label="Wake up" value={wake} field="wake" />
          <View style={styles.divider} />
          <TimeRow label="Bedtime" value={bed} field="bed" />
        </View>

        {/* Work */}
        <Text style={styles.sectionLabel}>WORK HOURS</Text>
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <Text style={styles.timeRowLabel}>I have set work hours</Text>
            <Switch
              value={workOn}
              onValueChange={toggleWork}
              trackColor={{ true: C.primary, false: C.surfaceContainerHigh }}
              thumbColor="#fff"
            />
          </View>
          {workOn && (
            <>
              <View style={styles.divider} />
              <TimeRow label="Starts" value={workStart} field="workStart" />
              <View style={styles.divider} />
              <TimeRow label="Ends" value={workEnd} field="workEnd" />
            </>
          )}
        </View>

        {/* School */}
        <Text style={styles.sectionLabel}>SCHOOL HOURS</Text>
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <Text style={styles.timeRowLabel}>I have set school hours</Text>
            <Switch
              value={schoolOn}
              onValueChange={toggleSchool}
              trackColor={{ true: C.primary, false: C.surfaceContainerHigh }}
              thumbColor="#fff"
            />
          </View>
          {schoolOn && (
            <>
              <View style={styles.divider} />
              <TimeRow label="Starts" value={schoolStart} field="schoolStart" />
              <View style={styles.divider} />
              <TimeRow label="Ends" value={schoolEnd} field="schoolEnd" />
            </>
          )}
        </View>

        {/* Preferred time of day */}
        <Text style={styles.sectionLabel}>PREFERRED TIME TO TRAIN</Text>
        <View style={styles.segmented}>
          {TODS.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[styles.segment, tod === t.id && styles.segmentActive]}
              onPress={() => setTod(tod === t.id ? null : t.id)}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentText, tod === t.id && styles.segmentTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>Tempo aims for this window, then varies the exact time so your week isn't robotic.</Text>

        {/* Days completely off */}
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
              >
                <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{d.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
        <Text style={styles.hint}>
          For religious observance (e.g. Shabbat), a standing commitment, or any day you
          simply rest. Tempo never schedules a workout here. Add specific times later in Settings.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, saving && { opacity: 0.6 }]}
          onPress={handleContinue}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color={C.onPrimary} /> : <Text style={styles.continueBtnText}>Continue</Text>}
        </TouchableOpacity>
      </View>

      <TimePickerSheet
        visible={picker !== null}
        value={pickerValue()}
        title={picker ? pickerTitle[picker] : ''}
        onSelect={applyPicker}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  logo: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: C.primary, letterSpacing: 2 },
  skipTop: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.textSecondary },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.lg },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.sm },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22, marginBottom: Spacing.xs },

  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  card: {
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    ...CardShadow, overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: Spacing.md },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  timeRowLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  timeRowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  timeRowValue: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 2 },

  segmented: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: 4, gap: 4 },
  segment: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center' },
  segmentActive: { backgroundColor: C.background, ...CardShadow, shadowOpacity: 0.08 },
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
