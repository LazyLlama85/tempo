// Tempo — onboarding sleep step (2026-07-17 restructure).
//
// Split off the old single "When does life happen?" screen (sleep + work + school
// + preferred time + off-days all squished together) into its own single-purpose
// step — Sleep here, Work/School next, Preferred Time + Off Days after that.

import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark } from '@/components/brand'
import { PressableScale } from '@/components/motion'
import { useAuthStore } from '@/stores/auth'
import { track } from '@/lib/analytics'
import { TimePickerSheet, formatTime12 } from '@/components/TimePickerSheet'

const TOTAL_STEPS = 6
type PickerField = 'wake' | 'bed'

export default function OnboardingSleepScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { profile } = useAuthStore()
  const params = useLocalSearchParams<{
    goal: string; experience: string; equipment: string; daysPerWeek: string; schedulingMode?: string; sessionMinutes?: string; buildMode?: string; includeCardio?: string
  }>()

  const [wake, setWake] = useState<string | null>(profile?.wake_time ?? '06:30:00')
  const [bed, setBed] = useState<string | null>(profile?.bedtime ?? '22:30:00')
  const [picker, setPicker] = useState<PickerField | null>(null)

  const goNext = () => {
    track('onboarding_step_completed', { step: 'sleep' })
    router.push({
      pathname: '/onboarding/work-school',
      params: { ...params, wake: wake ?? '', bed: bed ?? '' },
    })
  }

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
        <View style={[styles.progressFill, { width: `${(3 / TOTAL_STEPS) * 100}%` }]} />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 3 OF {TOTAL_STEPS}</Text>
        <Text style={styles.title}>When do you sleep?</Text>
        <Text style={styles.subtitle}>Tempo never places a workout between bedtime and wake-up. You can change this later.</Text>

        <View style={styles.card}>
          <TouchableOpacity style={styles.timeRow} onPress={() => setPicker('wake')} activeOpacity={0.7}>
            <Text style={styles.timeRowLabel}>Wake up</Text>
            <View style={styles.timeRowRight}>
              <Text style={styles.timeRowValue}>{formatTime12(wake)}</Text>
              <Ionicons name="chevron-forward" size={16} color={C.outline} />
            </View>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.timeRow} onPress={() => setPicker('bed')} activeOpacity={0.7}>
            <Text style={styles.timeRowLabel}>Bedtime</Text>
            <View style={styles.timeRowRight}>
              <Text style={styles.timeRowValue}>{formatTime12(bed)}</Text>
              <Ionicons name="chevron-forward" size={16} color={C.outline} />
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PressableScale style={styles.continueBtn} onPress={goNext} activeOpacity={0.85}>
          <Text style={styles.continueBtnText}>Continue</Text>
        </PressableScale>
      </View>

      <TimePickerSheet
        visible={picker !== null}
        value={picker === 'wake' ? wake : bed}
        title={picker === 'wake' ? 'Wake-up time' : 'Bedtime'}
        onSelect={(v) => { if (picker === 'wake') setWake(v); else setBed(v); setPicker(null) }}
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
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  timeRowLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  timeRowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  timeRowValue: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
