import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark } from '@/components/brand'
import { PressableScale, FadeInView } from '@/components/motion'
import { useAuthStore } from '@/stores/auth'
import type { Experience } from '@/types'


// Each level previews a real slice of the program it unlocks — sample lifts with
// honest set×rep prescriptions — so the choice communicates consequences, not vibes.
const LEVELS: {
  id: Experience
  label: string
  tagline: string
  sub: string
  icon: string
  intensity: 1 | 2 | 3
  lifts: { name: string; rx: string }[]
}[] = [
  {
    id: 'beginner',
    label: 'Beginner',
    tagline: 'Build the foundation',
    sub: 'Form-first coaching and steady, confident progress.',
    icon: 'leaf-outline',
    intensity: 1,
    lifts: [
      { name: 'Goblet Squat', rx: '3 × 10' },
      { name: 'Push-Up', rx: '3 × 8' },
      { name: 'Dumbbell Row', rx: '3 × 10' },
    ],
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    tagline: 'Drive progressive overload',
    sub: 'Compound lifts, volume waves, and planned deloads.',
    icon: 'barbell-outline',
    intensity: 2,
    lifts: [
      { name: 'Barbell Squat', rx: '4 × 8' },
      { name: 'Bench Press', rx: '4 × 8' },
      { name: 'Romanian Deadlift', rx: '3 × 10' },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    tagline: 'Chase peak performance',
    sub: 'Periodized intensity with autoregulated heavy work.',
    icon: 'flash-outline',
    intensity: 3,
    lifts: [
      { name: 'Back Squat', rx: '5 × 5' },
      { name: 'Weighted Pull-Up', rx: '4 × 6' },
      { name: 'Barbell RDL', rx: '4 × 8' },
    ],
  },
]

export default function ExperienceScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { goal } = useLocalSearchParams<{ goal: string }>()
  const { profile } = useAuthStore()
  // Change Plan re-entry starts from the user's current (possibly auto-promoted)
  // level; fresh users start at beginner.
  const [selected, setSelected] = useState<Experience>(profile?.experience ?? 'beginner')

  const current = LEVELS.find((l) => l.id === selected)!

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
        <View style={[styles.progressFill, { width: '40%' }]} />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 2 OF 6</Text>
        <Text style={styles.title}>How much experience do you have?</Text>
        <Text style={styles.subtitle}>This sets your exercises, starting weights, and how hard we push from day one.</Text>

        {/* Segmented control */}
        <View style={styles.segmented}>
          {LEVELS.map((level) => (
            <PressableScale
              key={level.id}
              style={[styles.segment, selected === level.id && styles.segmentActive]}
              onPress={() => setSelected(level.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === level.id }}
            >
              <Text style={[styles.segmentText, selected === level.id && styles.segmentTextActive]}>
                {level.label}
              </Text>
            </PressableScale>
          ))}
        </View>

        {/* Preview card — a real glimpse of training at this level, crossfading as
            the selection changes so the choice feels alive. */}
        <FadeInView key={selected} duration={220}>
          <View style={styles.previewCard}>
            <View style={styles.previewHead}>
              <View style={styles.previewIconChip}>
                <Ionicons name={current.icon as any} size={20} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTagline}>{current.tagline}</Text>
                <Text style={styles.previewSub}>{current.sub}</Text>
              </View>
              <View
                style={styles.meter}
                accessible
                accessibilityLabel={`Training intensity ${current.intensity} of 3`}
              >
                {[1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[styles.meterBar, { height: 8 + i * 5 }, i <= current.intensity && styles.meterBarOn]}
                  />
                ))}
              </View>
            </View>

            <View style={styles.previewDivider} />

            <Text style={styles.previewEyebrow}>A SESSION AT THIS LEVEL</Text>
            {current.lifts.map((l) => (
              <View key={l.name} style={styles.liftRow}>
                <Ionicons name="checkmark-circle" size={16} color={C.primary} />
                <Text style={styles.liftName}>{l.name}</Text>
                <Text style={styles.liftRx}>{l.rx}</Text>
              </View>
            ))}
          </View>
        </FadeInView>

        {/* Reassurance: this isn't a permanent label. It removes the "am I really a
            beginner?" anxiety and makes the later auto-promotion feel promised. */}
        <View style={styles.hintRow}>
          <Ionicons name="trending-up" size={16} color={C.primary} />
          <Text style={styles.hintText}>
            Start where you are — Tempo automatically levels you up as you get stronger.
          </Text>
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={styles.footer}>
        <PressableScale
          style={styles.continueBtn}
          onPress={() => router.push({ pathname: '/onboarding/equipment', params: { goal, experience: selected } })}
          activeOpacity={0.85}
        >
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
  logo: { fontFamily: C.fontDisplay, fontSize: 15, color: C.primary, letterSpacing: 2 },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.lg },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.lg },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },
  segmented: {
    flexDirection: 'row', backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.lg, padding: 4, gap: 4,
  },
  segment: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center' },
  segmentActive: { backgroundColor: C.background, shadowColor: C.text, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  segmentText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  segmentTextActive: { fontFamily: 'Inter_700Bold', color: C.text },

  previewCard: {
    backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: Spacing.sm,
  },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  previewIconChip: {
    width: 44, height: 44, borderRadius: Radius.md, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  previewTagline: { fontFamily: C.fontDisplay, fontSize: 17, color: C.text, letterSpacing: -0.2 },
  previewSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 17, marginTop: 2 },
  meter: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 23 },
  meterBar: { width: 5, borderRadius: Radius.full, backgroundColor: C.surfaceContainerHigh },
  meterBarOn: { backgroundColor: C.primary },
  previewDivider: { height: 1, backgroundColor: C.surfaceContainerHigh },
  previewEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10.5, color: C.outline, letterSpacing: 0.6 },
  liftRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: 2 },
  liftName: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14.5, color: C.text },
  liftRx: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },

  hintRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.xs },
  hintText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
