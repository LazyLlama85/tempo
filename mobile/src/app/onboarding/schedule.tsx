import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark } from '@/components/brand'
import { PressableScale } from '@/components/motion'
import { useAuthStore } from '@/stores/auth'


export default function ScheduleScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { goal, experience, equipment } = useLocalSearchParams<{ goal: string; experience: string; equipment: string }>()
  const { profile } = useAuthStore()
  // Change Plan re-entry keeps the user's current cadence + scheduling mode —
  // re-running onboarding must never silently flip a manual scheduler back to auto.
  const [daysPerWeek, setDaysPerWeek] = useState(() => {
    const d = profile?.days_per_week ?? 3
    return d >= 2 && d <= 6 ? d : 3
  })
  // Connecting a calendar does NOT force automatic scheduling — the user chooses.
  // Calendar connection itself now happens after onboarding (Home prompt / Profile →
  // Calendar), so the critical path to a first workout never touches OAuth. A user
  // who never connects still gets auto placement from Tempo's free-slot engine.
  const [schedulingMode, setSchedulingMode] = useState<'auto' | 'manual'>(
    profile?.scheduling_mode === 'manual' ? 'manual' : 'auto',
  )

  // Carry the cadence + scheduling mode forward. (An already-connected calendar, e.g.
  // on Change Plan re-entry, keeps its saved preferred_calendar — plan-preview leaves
  // that field untouched when no preferredCalendar param is present.)
  const goNext = () => router.push({
    pathname: '/onboarding/availability',
    params: { goal, experience, equipment, daysPerWeek: String(daysPerWeek), schedulingMode },
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
        <View style={[styles.progressFill, { width: '50%' }]} />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 2 OF 4</Text>
        <Text style={styles.title}>Your training rhythm.</Text>
        <Text style={styles.subtitle}>
          How many days a week, and whether Tempo places each workout for you or you
          pick the times yourself. You can connect a calendar later for smarter placement.
        </Text>

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

        {/* How to schedule — connecting a calendar (later) doesn't force automatic */}
        <View style={styles.modeSection}>
          <Text style={styles.whyLabel}>HOW DO YOU WANT WORKOUTS SCHEDULED?</Text>
          {([
            { key: 'auto' as const, icon: 'sparkles' as const, title: 'Automatically schedule workouts', sub: 'Tempo reads your free time and places each workout around your real day — you can still edit any time.' },
            { key: 'manual' as const, icon: 'hand-left' as const, title: "I'll schedule workouts myself", sub: 'You pick the times. Tempo never moves them on its own (your calendar is still used to show busy times).' },
          ]).map((opt) => {
            const sel = schedulingMode === opt.key
            return (
              <PressableScale
                key={opt.key}
                style={[styles.modeCard, sel && styles.modeCardSel]}
                onPress={() => setSchedulingMode(opt.key)}
                activeOpacity={0.8}
              >
                <Ionicons name={opt.icon} size={20} color={sel ? C.primary : C.outline} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modeTitle, sel && { color: C.primary }]}>{opt.title}</Text>
                  <Text style={styles.modeSub}>{opt.sub}</Text>
                </View>
                <Ionicons name={sel ? 'radio-button-on' : 'radio-button-off'} size={20} color={sel ? C.primary : C.outline} />
              </PressableScale>
            )
          })}
        </View>

        {/* Calendar preview — a glimpse of automatic placement around real events */}
        <View style={styles.calendarPreview}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewDate}>Tuesday, Oct 24</Text>
            <View style={styles.previewDots}>
              <View style={[styles.dot, { backgroundColor: '#EA4335' }]} />
              <View style={[styles.dot, { backgroundColor: C.primary }]} />
            </View>
          </View>
          {/* Timeline preview */}
          <View style={styles.previewTimeline}>
            <View style={styles.previewRow}>
              <Text style={styles.previewTime}>8:00 AM</Text>
              <View style={styles.previewEvent}><Text style={styles.previewEventText}>Team Standup</Text></View>
            </View>
            <View style={styles.previewRow}>
              <Text style={[styles.previewTime, { color: C.primary }]}>10:30 AM</Text>
              <View style={styles.previewWorkout}>
                <View style={styles.idealBadge}>
                  <Text style={styles.idealBadgeText}>IDEAL TRAINING WINDOW</Text>
                  <Ionicons name="sparkles" size={10} color={C.primary} />
                </View>
                <Text style={styles.previewWorkoutTitle}>Upper Body Power</Text>
                <Text style={styles.previewWorkoutMeta}>45 Minutes • Free Time detected</Text>
              </View>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewTime}>12:00 PM</Text>
              <View style={styles.previewEvent}><Text style={styles.previewEventText}>Project Review</Text></View>
            </View>
          </View>
        </View>
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
  whyLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  modeSection: { gap: Spacing.sm },
  modeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: C.background, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: C.outlineVariant },
  modeCardSel: { borderColor: C.primary, backgroundColor: C.primarySoft },
  modeTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  modeSub: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18, marginTop: 2 },
  calendarPreview: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewDate: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  previewDots: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: Radius.full },
  previewTimeline: { gap: Spacing.sm },
  previewRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  previewTime: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline, width: 58, paddingTop: 12 },
  previewEvent: { flex: 1, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.md, padding: Spacing.sm },
  previewEventText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  previewWorkout: {
    flex: 1, borderRadius: Radius.md, padding: Spacing.sm,
    borderWidth: 1.5, borderColor: C.primary, borderStyle: 'dashed',
    backgroundColor: `${C.primary}08`, gap: 3,
  },
  idealBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  idealBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.primary, letterSpacing: 0.4 },
  previewWorkoutTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },
  previewWorkoutMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary },
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
  dayBtnTextSelected: { color: C.onPrimary },
})
