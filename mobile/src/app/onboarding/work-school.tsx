// Tempo — onboarding work/school step (2026-07-17 restructure).
//
// Was two separate sections (Work Hours + School Hours) on the old crowded
// availability screen — merged into ONE question, since a user has one or the
// other, not both, and asking twice for the same concept felt redundant. Writes
// the same start/end into BOTH work_start/end AND school_start/end so every
// existing consumer (lib/availability.ts's busy-window builder, autoSchedule.ts,
// reschedule.ts) keeps working unchanged — they already treat the two fields
// additively, so a duplicate identical window is harmless.

import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Switch } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark } from '@/components/brand'
import { PressableScale } from '@/components/motion'
import { useAuthStore } from '@/stores/auth'
import { TimePickerSheet, formatTime12 } from '@/components/TimePickerSheet'

const TOTAL_STEPS = 6
type PickerField = 'start' | 'end'

export default function OnboardingWorkSchoolScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { profile } = useAuthStore()
  const params = useLocalSearchParams<{
    goal: string; experience: string; equipment: string; daysPerWeek: string; schedulingMode?: string; sessionMinutes?: string; buildMode?: string; includeCardio?: string; wake?: string; bed?: string
  }>()

  // Pre-fill from whichever of the two fields is already set (Change Plan re-entry).
  const existingStart = profile?.work_start ?? profile?.school_start ?? null
  const existingEnd = profile?.work_end ?? profile?.school_end ?? null
  const [on, setOn] = useState(existingStart != null && existingEnd != null)
  const [start, setStart] = useState<string | null>(existingStart ?? '09:00:00')
  const [end, setEnd] = useState<string | null>(existingEnd ?? '17:00:00')
  const [picker, setPicker] = useState<PickerField | null>(null)

  const toggleOn = (v: boolean) => {
    setOn(v)
    if (v && (start == null || end == null)) { setStart('09:00:00'); setEnd('17:00:00') }
  }

  const goNext = () => router.push({
    pathname: '/onboarding/train-time',
    params: { ...params, workSchoolStart: on ? (start ?? '') : '', workSchoolEnd: on ? (end ?? '') : '' },
  })

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <TempoWordmark size={16} />
        <TouchableOpacity onPress={goNext} hitSlop={8}>
          <Text style={styles.skipTop}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(4 / TOTAL_STEPS) * 100}%` }]} />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 4 OF {TOTAL_STEPS}</Text>
        <Text style={styles.title}>Work or school hours?</Text>
        <Text style={styles.subtitle}>Tempo schedules around this window instead of on top of it.</Text>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <Text style={styles.timeRowLabel}>I have set work or school hours</Text>
            <Switch
              value={on}
              onValueChange={toggleOn}
              trackColor={{ true: C.primary, false: C.surfaceContainerHigh }}
              thumbColor="#fff"
            />
          </View>
          {on && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.timeRow} onPress={() => setPicker('start')} activeOpacity={0.7}>
                <Text style={styles.timeRowLabel}>Starts</Text>
                <View style={styles.timeRowRight}>
                  <Text style={styles.timeRowValue}>{formatTime12(start)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={C.outline} />
                </View>
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.timeRow} onPress={() => setPicker('end')} activeOpacity={0.7}>
                <Text style={styles.timeRowLabel}>Ends</Text>
                <View style={styles.timeRowRight}>
                  <Text style={styles.timeRowValue}>{formatTime12(end)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={C.outline} />
                </View>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PressableScale style={styles.continueBtn} onPress={goNext} activeOpacity={0.85}>
          <Text style={styles.continueBtnText}>Continue</Text>
        </PressableScale>
      </View>

      <TimePickerSheet
        visible={picker !== null}
        value={picker === 'start' ? start : end}
        title={picker === 'start' ? 'Starts' : 'Ends'}
        onSelect={(v) => { if (picker === 'start') setStart(v); else setEnd(v); setPicker(null) }}
        onClose={() => setPicker(null)}
      />
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
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },
  card: {
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    ...Elevation.e1, overflow: 'hidden', marginTop: Spacing.sm,
  },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: Spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  timeRowLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  timeRowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  timeRowValue: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
