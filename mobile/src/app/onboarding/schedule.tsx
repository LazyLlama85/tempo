import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Switch } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark } from '@/components/brand'
import { PressableScale } from '@/components/motion'
import { useAuthStore } from '@/stores/auth'


const SESSION_MINUTES = [30, 45, 60, 75, 90] as const

// Onboarding step count (2026-07-17 restructure): 6 lighter, single-purpose
// screens instead of 4 dense ones — Basics / Schedule / Sleep / Work-School /
// Train Time / Plan Preview. Each screen keeps its own literal "STEP N OF 6".
const TOTAL_STEPS = 6

export default function ScheduleScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { goal, experience, equipment, buildMode } = useLocalSearchParams<{ goal: string; experience: string; equipment: string; buildMode?: string }>()
  const { profile } = useAuthStore()
  // Change Plan re-entry keeps the user's current cadence.
  const [daysPerWeek, setDaysPerWeek] = useState(() => {
    const d = profile?.days_per_week ?? 3
    return d >= 2 && d <= 6 ? d : 3
  })
  // B3.3 — the time-budget question. Previously never asked: every new user
  // silently got a hardcoded 45-minute session regardless of how much time they
  // actually have, and preferred_duration_min directly drives how many exercises
  // generatePlan picks per session (exerciseCountForDuration) — so this isn't
  // cosmetic, it changes the plan the user actually gets.
  const [sessionMinutes, setSessionMinutes] = useState(() => {
    const m = profile?.preferred_duration_min ?? 45
    return SESSION_MINUTES.includes(m as typeof SESSION_MINUTES[number]) ? m : 45
  })
  // Scheduling mode is no longer an onboarding QUESTION (2026-07-17 — the founder
  // felt the auto/manual choice + a mockup implying varying daily times cluttered
  // this screen and undersold consistency). New users silently get 'auto' (the
  // same default this choice always defaulted to); an EXISTING user re-planning
  // keeps whatever they already chose — never silently reset to auto. Manual mode
  // is still fully available afterward from Settings → Automatic Scheduling.
  const schedulingMode = profile?.scheduling_mode === 'manual' ? 'manual' : 'auto'
  // Optional cardio question (Phase 7c) — only meaningful for muscle_gain/strength,
  // whose templates carry zero cardio by design; fat_loss/athletic/general_fitness
  // already bake it in on some days regardless, so asking there would be a
  // question that does nothing — keep onboarding honest, don't show it.
  const cardioMatters = (goal === 'muscle_gain' || goal === 'strength') && buildMode !== 'custom'
  const [includeCardio, setIncludeCardio] = useState(!!profile?.include_cardio)

  const goNext = () => router.push({
    pathname: '/onboarding/sleep',
    params: {
      goal, experience, equipment, daysPerWeek: String(daysPerWeek), schedulingMode, sessionMinutes: String(sessionMinutes), buildMode,
      includeCardio: cardioMatters && includeCardio ? 'true' : 'false',
    },
  })

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <TempoWordmark size={16} />
        <View style={{ width: 38 }} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(2 / TOTAL_STEPS) * 100}%` }]} />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 2 OF {TOTAL_STEPS}</Text>
        <Text style={styles.title}>Your training rhythm.</Text>
        <Text style={styles.subtitle}>How many days a week, and how long each session realistically is.</Text>

        {/* Days per week selector */}
        <View style={styles.daysSection}>
          <Text style={styles.daysSectionLabel}>DAYS PER WEEK</Text>
          <View style={styles.daysRow}>
            {[2, 3, 4, 5, 6].map((d) => (
              <PressableScale
                key={d}
                style={[styles.dayBtn, daysPerWeek === d && styles.dayBtnSelected]}
                onPress={() => setDaysPerWeek(d)}
                activeOpacity={0.7}
              >
                <Text style={[styles.dayBtnText, daysPerWeek === d && styles.dayBtnTextSelected]}>
                  {d}
                </Text>
              </PressableScale>
            ))}
          </View>
        </View>

        {/* Session length — the time-budget question (B3.3): drives how many
            exercises generatePlan picks per session, so this isn't decorative. */}
        <View style={styles.daysSection}>
          <Text style={styles.daysSectionLabel}>MINUTES PER SESSION</Text>
          <View style={styles.daysRow}>
            {SESSION_MINUTES.map((m) => (
              <PressableScale
                key={m}
                style={[styles.dayBtn, sessionMinutes === m && styles.dayBtnSelected]}
                onPress={() => setSessionMinutes(m)}
                activeOpacity={0.7}
              >
                <Text style={[styles.minBtnText, sessionMinutes === m && styles.dayBtnTextSelected]}>
                  {m}
                </Text>
              </PressableScale>
            ))}
          </View>
        </View>

        {/* Optional cardio finisher — only asked when it actually changes anything */}
        {cardioMatters && (
          <View style={styles.cardioRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardioTitle}>Add a cardio finisher?</Text>
              <Text style={styles.cardioSub}>Optional — tacks a short cardio move onto some sessions. Off by default.</Text>
            </View>
            <Switch
              value={includeCardio}
              onValueChange={setIncludeCardio}
              trackColor={{ false: C.surfaceContainerHigh, true: C.primary }}
              thumbColor="#fff"
            />
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PressableScale style={styles.continueBtn} onPress={goNext} activeOpacity={0.85}>
          <Text style={styles.continueBtnText}>Continue</Text>
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
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.lg },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.lg },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },
  cardioRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  cardioTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  cardioSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, marginTop: 2, lineHeight: 17 },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  daysSection: { gap: Spacing.xs },
  daysSectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  daysRow: { flexDirection: 'row', gap: Spacing.sm },
  dayBtn: {
    flex: 1, aspectRatio: 1, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  dayBtnSelected: { backgroundColor: C.primary, borderColor: C.primary },
  dayBtnText: { fontFamily: 'Inter_700Bold', fontSize: 20, color: C.text },
  minBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  dayBtnTextSelected: { color: C.onPrimary },
})
